import { FailureClass } from "../core/errors.ts";
import { IRValidator, OmegaIR } from "../core/ir.ts";
import { NodeId } from "../core/types.ts";
import { ClassificationResult } from "./classifier.ts";

export interface DiagnosisReport {
  failedNode: NodeId;
  failureClass: FailureClass;
  confidence: number;
  rootCause: string;
  blastRadiusNodes: NodeId[];
  recommendedStrategy: string;
  isRecoverable: boolean;
  rationale: string;
}

export class DiagnosisEngine {
  static diagnose(
    ir: OmegaIR,
    failedNodeId: NodeId,
    classification: ClassificationResult
  ): DiagnosisReport {
    const blastRadius = IRValidator.getDependents(ir, failedNodeId);

    let rootCause = "Unknown system failure";
    let recommendedStrategy = "escalate";
    let isRecoverable = false;
    let rationale = "Manual operator intervention required.";

    switch (classification.failureClass) {
      case FailureClass.NetworkTransient:
        rootCause = "Transient network packet loss or socket disconnect";
        recommendedStrategy = "exponential_backoff_retry";
        isRecoverable = true;
        rationale = "Network transients typically resolve within exponential backoff windows.";
        break;

      case FailureClass.AuthExpired:
        rootCause = "Expired API token or refreshed credentials needed";
        recommendedStrategy = "refresh_credentials_and_resume";
        isRecoverable = true;
        rationale = "Refreshing authorization context and replaying from checkpoint safely restores execution.";
        break;

      case FailureClass.RateLimit:
        rootCause = "Upstream API rate quota exhausted";
        recommendedStrategy = "rate_limit_backoff";
        isRecoverable = true;
        rationale = "Pausing execution until quota bucket replenishment allows safe resumption without data loss.";
        break;

      case FailureClass.LLMOutputMalformed:
        rootCause = "LLM generated invalid format/schema output";
        recommendedStrategy = "reprompt_with_schema_repair";
        isRecoverable = true;
        rationale = "Reprompting with explicit schema correction and few-shot formatting fixes malformed outputs.";
        break;

      case FailureClass.LLMRefusal:
        rootCause = "Model safety or refusal filter triggered";
        recommendedStrategy = "reroute_to_fallback_model";
        isRecoverable = true;
        rationale = "Rerouting to an alternative configured model provider or rephrasing prompt context.";
        break;

      case FailureClass.TimeoutExceeded:
        rootCause = "Operation took longer than configured deadline";
        recommendedStrategy = "increase_deadline_or_compensate";
        isRecoverable = true;
        rationale = "Evaluating whether step can safely take more time or requires compensation rollback.";
        break;

      case FailureClass.SchemaChange:
        rootCause = "External API response payload schema modified unexpectedly";
        recommendedStrategy = "apply_schema_adapter";
        isRecoverable = true;
        rationale = "Adapt schema mapping if non-critical, or prepare migration for approval.";
        break;

      case FailureClass.StateCorruption:
        rootCause = "State consistency or invariant check failed";
        recommendedStrategy = "rollback_to_checkpoint_and_compensate";
        isRecoverable = false;
        rationale = "State corruption cannot be blindly retried; requires rollback to last valid checkpoint.";
        break;

      case FailureClass.DependencyOutage:
        rootCause = "Downstream service is experiencing total outage";
        recommendedStrategy = "switch_to_standby_provider";
        isRecoverable = true;
        rationale = "Reroute calls to designated standby provider if available.";
        break;

      case FailureClass.BudgetExhausted:
        rootCause = "Token or cost threshold reached";
        recommendedStrategy = "downgrade_model_or_escalate";
        isRecoverable = false;
        rationale = "Budget exhaustion requires operator approval or model downgrade.";
        break;

      case FailureClass.NetworkPermanent:
        rootCause = "DNS failure or unreachable remote endpoint";
        recommendedStrategy = "failover_or_escalate";
        isRecoverable = false;
        rationale = "Endpoint does not exist; operator configuration change required.";
        break;

      case FailureClass.ToolCallFailure:
        rootCause = "External tool returned execution error";
        recommendedStrategy = "retry_with_sanitized_inputs";
        isRecoverable = true;
        rationale = "Sanitize tool input arguments and retry within sandbox.";
        break;
    }

    return {
      failedNode: failedNodeId,
      failureClass: classification.failureClass,
      confidence: classification.confidence,
      rootCause,
      blastRadiusNodes: blastRadius,
      recommendedStrategy,
      isRecoverable,
      rationale,
    };
  }
}
