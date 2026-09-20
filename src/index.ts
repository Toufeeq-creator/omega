/**
 * ModusFlow Omega — The Reliability & Autonomous Recovery Substrate for AI Workflows
 *
 * Wrap any agent function, LLM tool call, or API handler in 2 lines of code.
 */

export { omega, protect } from "./middleware/protect.ts";
export type { ProtectOptions, ProtectResult } from "./middleware/protect.ts";

export { VirtualSideEffectProxy } from "./middleware/proxy.ts";
export type { RecordedSideEffect } from "./middleware/proxy.ts";

export { DynamicLensSynthesizer } from "./middleware/dynamic-lens.ts";
export type { DynamicLensResult, LensMapping } from "./middleware/dynamic-lens.ts";

export { SchemaAdapterEngine } from "./middleware/schema-adapter.ts";
export type { SchemaAdaptationResult } from "./middleware/schema-adapter.ts";

export { GovernanceGateway } from "./middleware/gateway.ts";
export type { RemediationPackage } from "./middleware/gateway.ts";

export { TransparentNetworkInterceptor } from "./middleware/transparent-interceptor.ts";
export type { InterceptionContext, RecordedWireCall } from "./middleware/transparent-interceptor.ts";

export { FailureClassifier } from "./recovery/classifier.ts";
export type { ClassificationResult, RawFailureContext } from "./recovery/classifier.ts";

export { CEGISEngine } from "./recovery/cegis-engine.ts";
export type {
  CandidateMutation, CEGISRepairResult, AttestationCertificate,
  CounterExample, MutationStrategy, ExpressionNode,
} from "./recovery/cegis-engine.ts";

export { InvariantEvaluator } from "./recovery/invariant-eval.ts";
export { FailureClass } from "./core/errors.ts";
export { AutonomyLevel } from "./core/policies.ts";
export type { Invariant, InvariantResult } from "./core/invariants.ts";
export type { OmegaIR, IRNode, IREdge } from "./core/ir.ts";
export { SqliteOmegaStore } from "./store/sqlite.ts";
export { ExecutionEngine } from "./runtime/engine.ts";
export { ReplayEngine } from "./runtime/replay.ts";
