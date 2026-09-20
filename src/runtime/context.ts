import { NodeId, RunId, WorkflowId } from "../core/types.ts";

export interface ExecutionContext {
  runId: RunId;
  workflowId: WorkflowId;
  nodeId: NodeId;
  inputs: unknown;
  previousOutputs: Record<NodeId, unknown>;
  attempt: number;
  idempotencyKey: string;
}

export function createExecutionContext(
  runId: RunId,
  workflowId: WorkflowId,
  nodeId: NodeId,
  inputs: unknown,
  previousOutputs: Record<NodeId, unknown>,
  attempt: number
): ExecutionContext {
  return {
    runId,
    workflowId,
    nodeId,
    inputs,
    previousOutputs,
    attempt,
    idempotencyKey: `${runId}:${nodeId}:${attempt}`,
  };
}
