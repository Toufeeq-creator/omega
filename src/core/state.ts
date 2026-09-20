import { NodeError } from "./errors.ts";
import { NodeId, RunId, WorkflowId } from "./types.ts";

export enum RunState {
  Pending = "Pending",
  Running = "Running",
  Completed = "Completed",
  Failed = "Failed",
  Recovering = "Recovering",
  Cancelled = "Cancelled",
  Paused = "Paused",
}

export type NodeState =
  | { status: "Pending" }
  | { status: "Scheduled" }
  | { status: "Running" }
  | { status: "Completed" }
  | { status: "Failed"; error: NodeError }
  | { status: "Cancelled" }
  | { status: "Compensating" }
  | { status: "Compensated" }
  | { status: "Recovering" }
  | { status: "Skipped" };

export interface ExecutionState {
  runId: RunId;
  workflowId: WorkflowId;
  runState: RunState;
  nodeStates: Record<NodeId, NodeState>;
  nodeOutputs: Record<NodeId, unknown>;
  startedAt: string;
  updatedAt: string;
  attemptCounts: Record<NodeId, number>;
  idempotencyKeys: string[];
}

export function createInitialState(runId: RunId, workflowId: WorkflowId, nodeIds: NodeId[]): ExecutionState {
  const nodeStates: Record<NodeId, NodeState> = {};
  for (const id of nodeIds) {
    nodeStates[id] = { status: "Pending" };
  }

  const now = new Date().toISOString();
  return {
    runId,
    workflowId,
    runState: RunState.Pending,
    nodeStates,
    nodeOutputs: {},
    startedAt: now,
    updatedAt: now,
    attemptCounts: {},
    idempotencyKeys: [],
  };
}
