export enum InvariantSeverity {
  Critical = "Critical", // Must not violate; blocks repair rollout
  Warning = "Warning",   // Flags warning; non-blocking
  Info = "Info",
}

export type InvariantKind =
  | { type: "NodeOutput"; nodeId: string; expression: string }
  | { type: "CrossNode"; nodeIds: string[]; expression: string }
  | { type: "BusinessRule"; expression: string };

export interface Invariant {
  id: string;
  description: string;
  kind: InvariantKind;
  severity: InvariantSeverity;
}

export interface InvariantResult {
  invariantId: string;
  passed: boolean;
  actualValue?: unknown;
  message?: string;
  checkedAt: string;
}
