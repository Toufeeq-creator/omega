import { FailureClass } from "./errors.ts";

export enum AutonomyLevel {
  Observe = 0,    // Level 0: Observe and log only
  Recommend = 1,  // Level 1: Recommend repair plan to human
  Prepare = 2,    // Level 2: Prepare repair in sandbox, await human approval
  Verify = 3,     // Level 3: Verify repair in sandbox, then apply automatically
  Canary = 4,     // Level 4: Canary in production, then apply automatically
  Autonomous = 5, // Level 5: Full immediate autonomous recovery
}

export interface RecoveryPolicy {
  failureClass: FailureClass;
  autonomyOverride?: AutonomyLevel;
  allowedStrategies: string[];
  maxAttempts: number;
}

export interface WorkflowPolicies {
  autonomyLevel: AutonomyLevel;
  recoveryPolicies: RecoveryPolicy[];
  maxRecoveryAttempts: number;
  requireInvariantCheck: boolean;
  requireSandboxVerification: boolean;
}

export const defaultPolicies: WorkflowPolicies = {
  autonomyLevel: AutonomyLevel.Verify, // L3 by default: verified before apply
  recoveryPolicies: [],
  maxRecoveryAttempts: 3,
  requireInvariantCheck: true,
  requireSandboxVerification: true,
};
