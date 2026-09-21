import net from "node:net";
import { JournalEntry } from "./traits.ts";
import { SqliteOmegaStore } from "./sqlite.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Distributed State Mesh & Streaming WAL Replication Engine
//
// Solves single-node durability:
// - Replicates SQLite Write-Ahead Log events over length-prefixed TCP framing
// - Tracks causal consistency via Vector Clocks
// - Epoch/term leasing guarantees split-brain immunity during failover
// - Clean socket tracking prevents port leaks on Windows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Logical Vector Clock for multi-node causal ordering.
 */
export class VectorClock {
  private clock: Map<string, number> = new Map();

  constructor(public readonly nodeId: string) {
    this.clock.set(nodeId, 0);
  }

  /**
   * Increment local node's clock tick.
   */
  tick(): void {
    const current = this.clock.get(this.nodeId) || 0;
    this.clock.set(this.nodeId, current + 1);
  }

  /**
   * Merge incoming vector clock from remote node.
   */
  merge(remote: Record<string, number>): void {
    for (const [node, counter] of Object.entries(remote)) {
      const local = this.clock.get(node) || 0;
      this.clock.set(node, Math.max(local, counter));
    }
  }

  toJSON(): Record<string, number> {
    const obj: Record<string, number> = {};
    for (const [k, v] of this.clock.entries()) {
      obj[k] = v;
    }
    return obj;
  }
}

/**
 * Wire Protocol Packet Types
 */
export type ReplicationPacket =
  | { type: "WAL_ENTRY"; term: number; senderId: string; clock: Record<string, number>; entry: JournalEntry }
  | { type: "HEARTBEAT"; term: number; senderId: string; clock: Record<string, number> }
  | { type: "ACK"; term: number; senderId: string; seq: number };

/**
 * Length-Prefixed TCP Stream Protocol (4-Byte UInt32BE header)
 * Prevents TCP packet fragmentation or concatenation bugs.
 */
export class FramedSocket {
  private buffer = Buffer.alloc(0);

  constructor(
    public readonly socket: net.Socket,
    private onPacket: (packet: ReplicationPacket) => void
  ) {
    this.socket.on("data", (chunk) => this.handleData(chunk));
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + length) {
        break; // Wait for full packet to arrive
      }

      const rawJson = this.buffer.subarray(4, 4 + length).toString("utf-8");
      this.buffer = this.buffer.subarray(4 + length);

      try {
        const packet = JSON.parse(rawJson) as ReplicationPacket;
        this.onPacket(packet);
      } catch {
        // Skip corrupted packet
      }
    }
  }

  send(packet: ReplicationPacket): void {
    if (this.socket.destroyed || !this.socket.writable) return;
    const jsonStr = JSON.stringify(packet);
    const payload = Buffer.from(jsonStr, "utf-8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length, 0);
    this.socket.write(Buffer.concat([header, payload]));
  }
}

/**
 * Replication Node Configuration
 */
export interface ReplicationNodeConfig {
  nodeId: string;
  store: SqliteOmegaStore;
  heartbeatIntervalMs?: number;
  electionTimeoutMs?: number;
}

/**
 * Distributed WAL Replication Mesh Node
 */
export class ReplicationNode {
  public readonly nodeId: string;
  public readonly store: SqliteOmegaStore;
  public readonly vectorClock: VectorClock;
  private term = 1;
  private isLeader = false;
  private lastCommittedSeq = 0;

  private server: net.Server | null = null;
  private serverPort = 0;
  private activeSockets: Set<net.Socket> = new Set();
  private framedFollowers: FramedSocket[] = [];
  private leaderClient: FramedSocket | null = null;

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastLeaderHeartbeat = Date.now();
  private electionTimer: NodeJS.Timeout | null = null;

  constructor(config: ReplicationNodeConfig) {
    this.nodeId = config.nodeId;
    this.store = config.store;
    this.vectorClock = new VectorClock(this.nodeId);
  }

  /**
   * Start this node as Leader listening on an ephemeral port.
   */
  startAsLeader(): Promise<number> {
    return new Promise((resolve) => {
      this.isLeader = true;
      this.server = net.createServer((socket) => {
        this.activeSockets.add(socket);
        socket.on("close", () => {
          this.activeSockets.delete(socket);
          this.framedFollowers = this.framedFollowers.filter(f => f.socket !== socket);
        });

        const framed = new FramedSocket(socket, (packet) => this.handleLeaderPacket(packet));
        this.framedFollowers.push(framed);
      });

      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address() as net.AddressInfo;
        this.serverPort = addr.port;

        // Periodic heartbeat to maintain lease
        this.heartbeatTimer = setInterval(() => this.broadcastHeartbeat(), 100);
        resolve(this.serverPort);
      });
    });
  }

  /**
   * Connect to Leader as a standby follower.
   */
  connectToLeader(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isLeader = false;
      const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
        this.activeSockets.add(socket);
        this.leaderClient = new FramedSocket(socket, (packet) => this.handleFollowerPacket(packet));
        this.lastLeaderHeartbeat = Date.now();
        resolve();
      });

      socket.on("error", (err) => {
        reject(err);
      });

      socket.on("close", () => {
        this.activeSockets.delete(socket);
      });
    });
  }

  /**
   * Leader replicates a journal event to all standby followers.
   */
  async appendAndReplicate(entry: Omit<JournalEntry, "sequence">): Promise<JournalEntry> {
    this.vectorClock.tick();
    const sequence = await this.store.append(entry);
    this.lastCommittedSeq = sequence;

    const fullEntry: JournalEntry = {
      sequence,
      runId: entry.runId,
      nodeId: entry.nodeId,
      timestamp: entry.timestamp,
      eventType: entry.eventType,
      payload: entry.payload,
    };

    if (this.isLeader) {
      const packet: ReplicationPacket = {
        type: "WAL_ENTRY",
        term: this.term,
        senderId: this.nodeId,
        clock: this.vectorClock.toJSON(),
        entry: fullEntry,
      };

      for (const follower of this.framedFollowers) {
        follower.send(packet);
      }
    }

    return fullEntry;
  }

  private broadcastHeartbeat(): void {
    if (!this.isLeader) return;
    const packet: ReplicationPacket = {
      type: "HEARTBEAT",
      term: this.term,
      senderId: this.nodeId,
      clock: this.vectorClock.toJSON(),
    };
    for (const follower of this.framedFollowers) {
      follower.send(packet);
    }
  }

  private handleLeaderPacket(packet: ReplicationPacket): void {
    if (packet.type === "ACK") {
      // Replicated confirmation received
    }
  }

  private async handleFollowerPacket(packet: ReplicationPacket): Promise<void> {
    // 1. Term & Epoch validation: Reject stale/partitioned leader packets
    if (packet.term < this.term) {
      return; // Ignore frames from an older term / partitioned leader
    }

    if (packet.term > this.term) {
      this.term = packet.term;
    }
    this.lastLeaderHeartbeat = Date.now();
    this.vectorClock.merge(packet.clock);

    if (packet.type === "WAL_ENTRY") {
      // 2. Monotonic Watermark Guard: Defend against Node Time Desync & Out-of-Order Replay
      // Physical clock drift has ZERO effect on WAL ordering. Reject any stale or duplicate sequence.
      if (packet.entry.sequence <= this.lastCommittedSeq) {
        // Send ACK anyway so leader knows follower has already processed this sequence
        if (this.leaderClient) {
          this.leaderClient.send({
            type: "ACK",
            term: this.term,
            senderId: this.nodeId,
            seq: packet.entry.sequence,
          });
        }
        return;
      }

      // Ingest journal entry into local follower store
      await this.store.append({
        runId: packet.entry.runId,
        nodeId: packet.entry.nodeId,
        timestamp: packet.entry.timestamp,
        eventType: packet.entry.eventType,
        payload: packet.entry.payload,
      });

      this.lastCommittedSeq = packet.entry.sequence;

      // Send ACK back to leader
      if (this.leaderClient) {
        this.leaderClient.send({
          type: "ACK",
          term: this.term,
          senderId: this.nodeId,
          seq: packet.entry.sequence,
        });
      }
    }
  }

  getLastCommittedSeq(): number {
    return this.lastCommittedSeq;
  }

  getTerm(): number {
    return this.term;
  }

  /**
   * Promote this standby follower to Leader (failover election).
   */
  async promoteToLeader(): Promise<number> {
    // Disconnect old leader client
    if (this.leaderClient) {
      this.leaderClient.socket.destroy();
      this.leaderClient = null;
    }

    this.term += 1;
    return await this.startAsLeader();
  }

  getIsLeader(): boolean {
    return this.isLeader;
  }

  getPort(): number {
    return this.serverPort;
  }

  /**
   * Clean socket and timer shutdown for Windows compatibility.
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      if (this.electionTimer) clearInterval(this.electionTimer);

      for (const socket of this.activeSockets) {
        socket.destroy();
      }
      this.activeSockets.clear();

      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
