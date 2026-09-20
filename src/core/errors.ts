export enum FailureClass {
  NetworkTransient = "NetworkTransient",
  NetworkPermanent = "NetworkPermanent",
  AuthExpired = "AuthExpired",
  RateLimit = "RateLimit",
  SchemaChange = "SchemaChange",
  LLMOutputMalformed = "LLMOutputMalformed",
  LLMRefusal = "LLMRefusal",
  ToolCallFailure = "ToolCallFailure",
  TimeoutExceeded = "TimeoutExceeded",
  StateCorruption = "StateCorruption",
  DependencyOutage = "DependencyOutage",
  BudgetExhausted = "BudgetExhausted",
}

export interface NodeError {
  failureClass: FailureClass;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

export class OmegaError extends Error {
  constructor(message: string, public code: string, public details?: unknown) {
    super(message);
    this.name = "OmegaError";
  }
}
