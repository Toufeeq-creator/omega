import http from "node:http";
import { AddressInfo } from "node:net";

export interface ChaosServerStats {
  chargesReceived: number;
  rateLimitHits: number;
  authFailures: number;
  schemaDriftHits: number;
  socketDrops: number;
  successfulSettlements: number;
}

/**
 * Real Live HTTP Chaos Server.
 * Runs on a real local TCP port, simulating real-world network and API failure modes:
 * - Real HTTP 429 with Retry-After headers
 * - Real HTTP 401 Unauthorized with token expiration
 * - Real TCP connection drops (socket destruction mid-flight)
 * - Real third-party API schema mutation/drift
 * - Real destructive external API tracking (Stripe/Payment POST counter)
 */
export class LiveChaosServer {
  private server: http.Server | null = null;
  public port: number = 0;
  public baseUrl: string = "";

  public stats: ChaosServerStats = {
    chargesReceived: 0,
    rateLimitHits: 0,
    authFailures: 0,
    schemaDriftHits: 0,
    socketDrops: 0,
    successfulSettlements: 0,
  };

  // Chaos controls
  public forceRateLimitNext = 0;
  public forceAuthFailureNext = 0;
  public forceSocketDropNext = false;
  public forceSchemaDrift = false;
  public forceMalformedJsonNext = false;

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        let body = "";

        req.on("data", (chunk) => {
          body += chunk;
        });

        req.on("end", () => {
          this.handleRequest(url.pathname, req, res, body);
        });
      });

      this.server.on("error", reject);

      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address() as AddressInfo;
        this.port = addr.port;
        this.baseUrl = `http://127.0.0.1:${this.port}`;
        resolve(this.baseUrl);
      });
    });
  }

  private handleRequest(
    pathname: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: string
  ): void {
    // 1. Simulating TCP Connection Reset / Socket Drop
    if (this.forceSocketDropNext) {
      this.forceSocketDropNext = false;
      this.stats.socketDrops++;
      req.socket.destroy(new Error("ECONNRESET"));
      return;
    }

    // 2. Simulating External Destructive Payment (e.g. Stripe API)
    if (pathname === "/v1/charges" && req.method === "POST") {
      this.stats.chargesReceived++;
      const payload = body ? JSON.parse(body) : {};
      const key = (req.headers["idempotency-key"] as string) || payload.idempotencyKey || `key_${this.stats.chargesReceived}`;
      const chargeId = `ch_live_${Math.random().toString(36).slice(2, 10)}`;
      const record = {
        id: chargeId,
        status: "succeeded",
        amount: payload.amount || 50000,
        currency: "usd",
        chargeCounter: this.stats.chargesReceived,
        idempotencyKey: key,
      };

      (this as any).idempotencyMap = (this as any).idempotencyMap || new Map();
      (this as any).idempotencyMap.set(key, record);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(record));
      return;
    }

    // 2b. Lookup charge by idempotency key (Stripe / Bank reconciliation API)
    if (pathname === "/v1/charges/lookup" && req.method === "GET") {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const key = url.searchParams.get("key") || "";
      const map: Map<string, any> = (this as any).idempotencyMap || new Map();
      const existing = map.get(key);

      if (existing) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(existing));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Charge not found for idempotency key" }));
      }
      return;
    }

    // 3. Simulating Upstream Partner Rate Limit (HTTP 429)
    if (this.forceRateLimitNext > 0) {
      this.forceRateLimitNext--;
      this.stats.rateLimitHits++;
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": "1",
        "X-RateLimit-Limit": "100",
        "X-RateLimit-Remaining": "0",
      });
      res.end(
        JSON.stringify({
          error: "Too Many Requests",
          message: "API 429: Partner rate quota exceeded for billing tier",
          retryAfterMs: 500,
        })
      );
      return;
    }

    // 4. Simulating Expired Credentials (HTTP 401)
    if (this.forceAuthFailureNext > 0) {
      this.forceAuthFailureNext--;
      this.stats.authFailures++;
      res.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": "Bearer error=\"invalid_token\", error_description=\"The token expired\"",
      });
      res.end(
        JSON.stringify({
          error: "Unauthorized",
          message: "401 Unauthorized: JWT bearer token expired at provider",
        })
      );
      return;
    }

    // 5. Simulating Malformed JSON from LLM / Third Party
    if (this.forceMalformedJsonNext) {
      this.forceMalformedJsonNext = false;
      res.writeHead(200, { "Content-Type": "application/json" });
      // Deliberate corrupted syntax with trailing unescaped characters
      res.end('{"status": "ok", "debits": 50000.0, "credits": 50000.0, corrupted_syntax_unquoted');
      return;
    }

    // 6. Simulating Real Schema Drift (Breaking API Contract!)
    if (this.forceSchemaDrift) {
      this.stats.schemaDriftHits++;
      res.writeHead(200, { "Content-Type": "application/json" });
      // The upstream API suddenly changes: drops root 'debits'/'credits', wraps under data.attributes.total_amount_cents
      res.end(
        JSON.stringify({
          apiVersion: "2026-09-01",
          data: {
            type: "ledger_batch",
            attributes: {
              batch_ref: "BATCH-DRIFT-99",
              total_amount_cents: 5000000, // 50,000 USD in cents
              settlementConfirmed: true,
            },
          },
        })
      );
      return;
    }

    // 7. Standard Successful Settlement Response
    if (pathname === "/v1/settlements") {
      this.stats.successfulSettlements++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "settled",
          debits: 50000.0,
          credits: 50000.0,
          settlement_confirmed: true,
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Endpoint not found" }));
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
