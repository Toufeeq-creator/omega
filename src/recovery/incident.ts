import { FailureClass } from "../core/errors.ts";
import { IncidentId, NodeId, RunId, WorkflowId } from "../core/types.ts";
import { CanaryReport } from "./canary.ts";
import { DiagnosisReport } from "./diagnosis.ts";
import { RepairPlan } from "./repair.ts";
import { SandboxReport } from "./sandbox.ts";

export interface IncidentReport {
  incidentId: IncidentId;
  runId: RunId;
  workflowId: WorkflowId;
  failedNode: NodeId;
  failureClass: FailureClass;
  detectedAt: string;
  recoveredAt?: string;
  timeToRecoveryMs?: number;
  diagnosis: DiagnosisReport;
  repairPlan: RepairPlan;
  sandboxReport?: SandboxReport;
  canaryReport?: CanaryReport;
  recovered: boolean;
  humanInterventionRequired: boolean;
  estimatedCostAvoidedUsd: number;
}

export class IncidentReportGenerator {
  static toMarkdown(report: IncidentReport): string {
    const statusLabel = report.recovered ? "✅ RECOVERED (AUTONOMOUS)" : "⚠️ ESCALATED (REQUIRES OPERATOR)";
    const lines: string[] = [];

    lines.push(`# Forensic Incident Report: ${report.incidentId}`);
    lines.push("");
    lines.push(`- **Status:** ${statusLabel}`);
    lines.push(`- **Workflow ID:** \`${report.workflowId}\``);
    lines.push(`- **Run ID:** \`${report.runId}\``);
    lines.push(`- **Failed Node:** \`${report.failedNode}\``);
    lines.push(`- **Failure Class:** \`${report.failureClass}\``);
    lines.push(`- **Detected At:** ${report.detectedAt}`);
    if (report.timeToRecoveryMs !== undefined) {
      lines.push(`- **Time to Recovery (TTR):** \`${report.timeToRecoveryMs} ms\``);
    }
    lines.push(`- **Estimated Cost Avoided:** \`$${report.estimatedCostAvoidedUsd.toFixed(2)}\``);
    lines.push("");

    lines.push("## 1. Root Cause Diagnosis");
    lines.push(`- **Root Cause:** ${report.diagnosis.rootCause}`);
    lines.push(`- **Confidence Score:** ${(report.diagnosis.confidence * 100).toFixed(0)}%`);
    lines.push(`- **Downstream Blast Radius:** ${JSON.stringify(report.diagnosis.blastRadiusNodes)}`);
    lines.push(`- **Engineering Rationale:** ${report.diagnosis.rationale}`);
    lines.push("");

    lines.push("## 2. Verified Repair Plan");
    lines.push(`- **Strategy:** \`${report.repairPlan.strategyName}\``);
    lines.push(`- **Target Node:** \`${report.repairPlan.targetNode}\``);
    lines.push("- **Planned Actions:**");
    for (const act of report.repairPlan.actions) {
      lines.push(`  - \`${JSON.stringify(act)}\``);
    }
    lines.push("");

    if (report.sandboxReport) {
      lines.push("## 3. Isolated Sandbox Validation Evidence");
      lines.push(`- **Sandbox Verdict:** ${report.sandboxReport.passed ? "PASSED (0 regressions)" : "FAILED"}`);
      lines.push(`- **Evidence:** ${report.sandboxReport.evidence}`);
      lines.push("- **Invariants Verified:**");
      for (const inv of report.sandboxReport.invariantResults) {
        const mark = inv.passed ? "PASSED" : "FAILED";
        lines.push(`  - [${mark}] \`${inv.invariantId}\`: ${inv.message || "OK"}`);
      }
      lines.push("");
    }

    if (report.canaryReport) {
      lines.push("## 4. Canary Execution");
      lines.push(`- **Rollout Sample:** ${report.canaryReport.successfulRuns}/${report.canaryReport.sampleRunsExecuted} runs succeeded`);
      lines.push(`- **P95 Latency:** ${report.canaryReport.latencyP95Ms} ms`);
      lines.push("");
    }

    lines.push("## 5. Recovery Outcome");
    if (report.recovered) {
      lines.push("Workflow state restored from checkpoint. Execution resumed cleanly without human intervention.");
    } else {
      lines.push("Execution safely paused per organization governance policy. Operator action required.");
    }

    return lines.join("\n");
  }
}
