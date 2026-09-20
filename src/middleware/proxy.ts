import { RunId } from "../core/types.ts";

export interface RecordedSideEffect {
  actionName: string;
  idempotencyKey: string;
  parameters: unknown;
  response: unknown;
  timestamp: string;
}

/**
 * Virtualized Side-Effect Proxy.
 * Solves the "Side-Effect Mirage" in autonomous recovery:
 * Intercepts external writes/API mutations so that sandbox replays can verify invariants
 * WITHOUT double-charging credit cards, duplicate-sending emails, or corrupting remote DBs.
 */
export class VirtualSideEffectProxy {
  private isSandbox = false;
  private recordedCalls: Map<string, RecordedSideEffect> = new Map();

  constructor(public readonly runId: RunId, public readonly nodeName: string) {}

  /**
   * Switch proxy into isolated sandbox replay mode.
   * Remote destructive API calls are virtualized from journal or simulated.
   */
  enterSandboxMode(): void {
    this.isSandbox = true;
  }

  isSandboxMode(): boolean {
    return this.isSandbox;
  }

  /**
   * Generate an idempotent key for this side-effect invocation
   */
  getIdempotencyKey(actionName: string): string {
    return `${this.runId}:${this.nodeName}:${actionName}`;
  }

  /**
   * Wrap any external side-effect API call (Stripe, SendGrid, DB write, etc.)
   */
  async call<TResult>(
    actionName: string,
    executeRemote: () => Promise<TResult>,
    options?: { virtualResponse?: TResult }
  ): Promise<TResult> {
    const key = this.getIdempotencyKey(actionName);

    if (this.isSandbox) {
      // --- SANDBOX REPLAY MODE: DO NOT EXECUTE REAL REMOTE CALL! ---
      if (this.recordedCalls.has(key)) {
        return this.recordedCalls.get(key)!.response as TResult;
      }

      if (options?.virtualResponse !== undefined) {
        return options.virtualResponse;
      }

      // Default safe virtualized mock for known enterprise financial actions
      if (actionName.includes("stripe") || actionName.includes("charge") || actionName.includes("payment")) {
        return {
          id: `ch_mock_virtualized_${Math.random().toString(36).slice(2, 8)}`,
          status: "succeeded",
          amount: 50000.0,
          currency: "usd",
          virtualized: true,
          note: "Omega Virtualized Proxy prevented duplicate charge during sandbox verification.",
        } as unknown as TResult;
      }

      return { virtualized: true, status: "ok" } as unknown as TResult;
    }

    // --- LIVE MODE: EXECUTE & RECORD ---
    let result: TResult;
    try {
      result = await executeRemote();
    } catch (err: any) {
      // Ambiguous timeout recovery: if remote status check provided, verify if server processed it
      if (options && (options as any).checkRemoteStatus) {
        const existing = await (options as any).checkRemoteStatus(key);
        if (existing) {
          result = existing;
          this.recordedCalls.set(key, {
            actionName,
            idempotencyKey: key,
            parameters: null,
            response: result,
            timestamp: new Date().toISOString(),
          });
          return result;
        }
      }
      throw err;
    }

    this.recordedCalls.set(key, {
      actionName,
      idempotencyKey: key,
      parameters: null,
      response: result,
      timestamp: new Date().toISOString(),
    });

    return result;
  }

  /**
   * Safe fetch wrapper that automatically logs and virtualizes external HTTP requests
   */
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const actionName = `http_${init?.method || "GET"}_${url}`;
    const key = this.getIdempotencyKey(actionName);

    if (this.isSandbox) {
      // In sandbox mode, return recorded or virtualized response
      if (this.recordedCalls.has(key)) {
        const cached = this.recordedCalls.get(key)!.response as { status: number; body: string };
        return new Response(cached.body, { status: cached.status });
      }

      // Virtualized 200 OK
      return new Response(JSON.stringify({ status: "virtualized_ok", url }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const res = await globalThis.fetch(url, init);
    const cloned = res.clone();
    const bodyText = await cloned.text();

    this.recordedCalls.set(key, {
      actionName,
      idempotencyKey: key,
      parameters: { url, method: init?.method },
      response: { status: res.status, body: bodyText },
      timestamp: new Date().toISOString(),
    });

    return res;
  }
}
