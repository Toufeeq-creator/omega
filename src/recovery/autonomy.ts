import { AutonomyLevel } from "../core/policies.ts";

export interface AutonomyDecision {
  level: AutonomyLevel;
  canAutoApply: boolean;
  requiresSandbox: boolean;
  requiresCanary: boolean;
  requiresHumanApproval: boolean;
  message: string;
}

export class AutonomyGatekeeper {
  static decide(level: AutonomyLevel): AutonomyDecision {
    switch (level) {
      case AutonomyLevel.Observe:
        return {
          level,
          canAutoApply: false,
          requiresSandbox: false,
          requiresCanary: false,
          requiresHumanApproval: false,
          message: "Level 0 (Observe): Failure observed and logged only. No action taken.",
        };

      case AutonomyLevel.Recommend:
        return {
          level,
          canAutoApply: false,
          requiresSandbox: false,
          requiresCanary: false,
          requiresHumanApproval: true,
          message: "Level 1 (Recommend): Repair plan recommended to operators.",
        };

      case AutonomyLevel.Prepare:
        return {
          level,
          canAutoApply: false,
          requiresSandbox: true,
          requiresCanary: false,
          requiresHumanApproval: true,
          message: "Level 2 (Prepare): Repair plan prepared and verified in sandbox. Awaiting human approval.",
        };

      case AutonomyLevel.Verify:
        return {
          level,
          canAutoApply: true,
          requiresSandbox: true,
          requiresCanary: false,
          requiresHumanApproval: false,
          message: "Level 3 (Verify): Verified in isolated sandbox. Automatically applying repair.",
        };

      case AutonomyLevel.Canary:
        return {
          level,
          canAutoApply: true,
          requiresSandbox: true,
          requiresCanary: true,
          requiresHumanApproval: false,
          message: "Level 4 (Canary): Verified in sandbox and passed canary run. Automatically applying repair.",
        };

      case AutonomyLevel.Autonomous:
        return {
          level,
          canAutoApply: true,
          requiresSandbox: false,
          requiresCanary: false,
          requiresHumanApproval: false,
          message: "Level 5 (Autonomous): Full immediate autonomous recovery.",
        };
    }
  }
}
