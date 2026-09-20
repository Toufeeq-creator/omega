import { FailureClass } from "../core/errors.ts";

export interface RawFailureContext {
  errorMessage: string;
  httpStatus?: number;
  headers?: Record<string, string>;
  stdoutStderr?: string;
  stackTrace?: string;
}

export interface ClassificationResult {
  failureClass: FailureClass;
  confidence: number;
  evidence: string[];
}

export class FailureClassifier {
  static classify(ctx: RawFailureContext): ClassificationResult {
    const msg = ctx.errorMessage.toLowerCase();
    const evidence: string[] = [];

    // 1. AuthExpired (401, 403, "unauthorized", "token expired", "forbidden")
    if (
      ctx.httpStatus === 401 ||
      ctx.httpStatus === 403 ||
      msg.includes("401 unauthorized") ||
      msg.includes("token expired") ||
      msg.includes("jwt expired") ||
      msg.includes("invalid api key") ||
      msg.includes("credentials expired")
    ) {
      evidence.push(`Detected auth failure in message or status: ${ctx.httpStatus}`);
      return {
        failureClass: FailureClass.AuthExpired,
        confidence: 0.98,
        evidence,
      };
    }

    // 2. RateLimit (429, "rate limit", "too many requests", "quota exceeded")
    if (
      ctx.httpStatus === 429 ||
      msg.includes("rate limit") ||
      msg.includes("too many requests") ||
      msg.includes("quota exceeded") ||
      msg.includes("throttled")
    ) {
      evidence.push("HTTP 429 or rate limit throttling detected");
      return {
        failureClass: FailureClass.RateLimit,
        confidence: 0.99,
        evidence,
      };
    }

    // 3. TimeoutExceeded ("timed out", "deadline exceeded", "timeout")
    if (
      msg.includes("timed out") ||
      msg.includes("timeout") ||
      msg.includes("deadline exceeded") ||
      ctx.httpStatus === 504
    ) {
      evidence.push("Execution exceeded configured deadline/timeout");
      return {
        failureClass: FailureClass.TimeoutExceeded,
        confidence: 0.95,
        evidence,
      };
    }

    // 4. LLMOutputMalformed (JSON parse error, unexpected schema, trailing characters)
    if (
      msg.includes("failed to parse json") ||
      msg.includes("unexpected token") ||
      msg.includes("eof while parsing") ||
      msg.includes("json error") ||
      msg.includes("malformed json") ||
      msg.includes("trailing characters")
    ) {
      evidence.push("LLM output failed structural/JSON schema validation");
      return {
        failureClass: FailureClass.LLMOutputMalformed,
        confidence: 0.95,
        evidence,
      };
    }

    // 5. LLMRefusal ("content policy", "as an ai", "cannot fulfill", "safety refusal")
    if (
      msg.includes("content filter") ||
      msg.includes("safety policy") ||
      msg.includes("refused to respond") ||
      msg.includes("moderation violation")
    ) {
      evidence.push("Model triggered content or safety refusal filter");
      return {
        failureClass: FailureClass.LLMRefusal,
        confidence: 0.93,
        evidence,
      };
    }

    // 6. BudgetExhausted ("budget exceeded", "token limit", "cost exceeded")
    if (
      msg.includes("budget exceeded") ||
      msg.includes("token limit reached") ||
      msg.includes("cost exceeded")
    ) {
      evidence.push("Configured cost or token quota limit exhausted");
      return {
        failureClass: FailureClass.BudgetExhausted,
        confidence: 0.99,
        evidence,
      };
    }

    // 7. SchemaChange ("missing field", "unexpected type", "deserialization error")
    if (
      msg.includes("missing field") ||
      msg.includes("unknown field") ||
      msg.includes("invalid type") ||
      msg.includes("schema mismatch")
    ) {
      evidence.push("Payload structure deviated from expected schema contract");
      return {
        failureClass: FailureClass.SchemaChange,
        confidence: 0.91,
        evidence,
      };
    }

    // 8. StateCorruption ("invariant violated", "corrupted state", "checksum failure")
    if (
      msg.includes("invariant violated") ||
      msg.includes("corrupt") ||
      msg.includes("state mismatch")
    ) {
      evidence.push("State integrity or invariant violation detected");
      return {
        failureClass: FailureClass.StateCorruption,
        confidence: 0.92,
        evidence,
      };
    }

    // 9. NetworkTransient ("connection reset", "econnreset", "socket closed", "broken pipe")
    if (
      msg.includes("connection reset") ||
      msg.includes("econnreset") ||
      msg.includes("connection refused") ||
      msg.includes("temporarily unavailable") ||
      ctx.httpStatus === 503
    ) {
      evidence.push("Transient network/socket interruption detected");
      return {
        failureClass: FailureClass.NetworkTransient,
        confidence: 0.96,
        evidence,
      };
    }

    // 10. NetworkPermanent ("no such host", "dns error", "nxdomain", "unreachable")
    if (
      msg.includes("no such host") ||
      msg.includes("nxdomain") ||
      msg.includes("dns error")
    ) {
      evidence.push("Host DNS or route permanently unreachable");
      return {
        failureClass: FailureClass.NetworkPermanent,
        confidence: 0.95,
        evidence,
      };
    }

    // 11. DependencyOutage (500, 502, "service unavailable", "bad gateway")
    if (
      ctx.httpStatus === 500 ||
      ctx.httpStatus === 502 ||
      msg.includes("bad gateway") ||
      msg.includes("internal server error")
    ) {
      evidence.push(`Downstream service outage reported (HTTP ${ctx.httpStatus})`);
      return {
        failureClass: FailureClass.DependencyOutage,
        confidence: 0.94,
        evidence,
      };
    }

    // 12. ToolCallFailure
    evidence.push("Generic tool or execution step failure");
    return {
      failureClass: FailureClass.ToolCallFailure,
      confidence: 0.91,
      evidence,
    };
  }
}
