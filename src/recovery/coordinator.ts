import { OmegaIR } from "../core/ir.ts";
import { ExecutionState } from "../core/state.ts";
import { newIncidentId, NodeId } from "../core/types.ts";
import { AutonomyGatekeeper } from "./autonomy.ts";
import { CanaryController } from "./canary.ts";
import { FailureClassifier, RawFailureContext } from "./classifier.ts";
import { DiagnosisEngine } from "./diagnosis.ts";
import { IncidentReport } from "./incident.ts";
import { RepairPlanner } from "./repair.ts";
import { SandboxValidator } from "./sandbox.ts";

export class RecoveryCoordinator {
  static coordinateRecovery(
    ir: OmegaIR,
    state: ExecutionState,
    failedNode: NodeId,
    failureContext: RawFailureContext
  ): IncidentReport {
    const incidentId = newIncidentId();
    const detectedAt = new Date().toISOString();
    const startTime = Date.now();

    // 1. CLASSIFY
    const classification = FailureClassifier.classify(failureContext);

    // 2. DIAGNOSE
    const diagnosis = DiagnosisEngine.diagnose(ir, failedNode, classification);

    // 3. PLAN
    const repairPlan = RepairPlanner.plan(
      failedNode,
      classification.failureClass,
      diagnosis.recommendedStrategy
    );

    // 4. AUTONOMY GATE
    const autonomy = AutonomyGatekeeper.decide(ir.policies.autonomyLevel);

    // 5. INVARIANT CHECK & SANDBOX VERIFY
    let sandboxReport = undefined;
    if (autonomy.requiresSandbox) {
      sandboxReport = SandboxValidator.verify(ir, state, repairPlan, ir.invariants);
    }

    // 6. CANARY
    let canaryReport = undefined;
    if (autonomy.requiresCanary) {
      canaryReport = CanaryController.runCanary(10, 5);
    }

    // 7. APPLY / ESCALATE
    const sandboxPassed = sandboxReport ? sandboxReport.passed : true;
    const canaryPassed = canaryReport ? canaryReport.passed : true;
    const recovered = autonomy.canAutoApply && sandboxPassed && canaryPassed && diagnosis.isRecoverable;
    const humanInterventionRequired = !recovered;

    const endTime = Date.now();
    const timeToRecoveryMs = Math.max(1, endTime - startTime);

    return {
      incidentId,
      runId: state.runId,
      workflowId: ir.id,
      failedNode,
      failureClass: classification.failureClass,
      detectedAt,
      recoveredAt: recovered ? new Date().toISOString() : undefined,
      timeToRecoveryMs: recovered ? timeToRecoveryMs : undefined,
      diagnosis,
      repairPlan,
      sandboxReport,
      canaryReport,
      recovered,
      humanInterventionRequired,
      estimatedCostAvoidedUsd: 150.0,
    };
  }
}
