import http from "node:http";
import net from "node:net";

export interface ChaosProxyConfig {
  latencyMs?: number;
  jitterMs?: number;
  dropResponseAfterUpstreamExecution?: boolean;
  simulate504GatewayTimeout?: boolean;
}

/**
 * Network Chaos Proxy.
 * Sits between the client application and upstream HTTP servers,
 * injecting real-world WAN latency, packet drops, and ambiguous distributed timeouts.
 */
export class NetworkChaosProxy {
  private server: http.Server | null = null;
  public port = 0;
  public proxyUrl = "";

  public config: ChaosProxyConfig = {};
  public ambiguousDropsTriggered = 0;

  constructor(private upstreamTargetUrl: string) {}

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((clientReq, clientRes) => {
        this.handleProxyRequest(clientReq, clientRes);
      });

      this.server.on("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address() as net.AddressInfo;
        this.port = addr.port;
        this.proxyUrl = `http://127.0.0.1:${this.port}`;
        resolve(this.proxyUrl);
      });
    });
  }

  private handleProxyRequest(clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
    const upstreamUrl = new URL(clientReq.url || "/", this.upstreamTargetUrl);

    // Calculate delay with jitter
    const baseDelay = this.config.latencyMs || 0;
    const jitter = this.config.jitterMs ? Math.random() * this.config.jitterMs : 0;
    const totalDelay = baseDelay + jitter;

    setTimeout(() => {
      // 1. Gateway Timeout simulation
      if (this.config.simulate504GatewayTimeout) {
        this.config.simulate504GatewayTimeout = false;
        clientRes.writeHead(504, { "Content-Type": "application/json" });
        clientRes.end(JSON.stringify({ error: "Gateway Timeout", upstream: this.upstreamTargetUrl }));
        return;
      }

      // 2. Forward request to upstream target
      const proxyReq = http.request(
        upstreamUrl,
        {
          method: clientReq.method,
          headers: { ...clientReq.headers, host: upstreamUrl.host },
        },
        (upstreamRes) => {
          // --- AMBIGUOUS TIMEOUT SIMULATION ---
          // Upstream has EXECUTED the request (e.g. processed the credit card charge),
          // but the connection to client drops right before sending response!
          if (this.config.dropResponseAfterUpstreamExecution) {
            this.config.dropResponseAfterUpstreamExecution = false;
            this.ambiguousDropsTriggered++;
            // Brutally destroy client socket mid-transmission
            clientReq.socket.destroy(new Error("ECONNRESET: Ambiguous upstream response drop"));
            return;
          }

          clientRes.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
          upstreamRes.pipe(clientRes);
        }
      );

      proxyReq.on("error", (err) => {
        clientRes.writeHead(502, { "Content-Type": "application/json" });
        clientRes.end(JSON.stringify({ error: "Bad Gateway", message: err.message }));
      });

      clientReq.pipe(proxyReq);
    }, totalDelay);
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
