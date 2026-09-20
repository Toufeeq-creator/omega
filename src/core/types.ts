import { randomUUID } from "node:crypto";

export type WorkflowId = string;
export type RunId = string;
export type NodeId = string;
export type IncidentId = string;
export type CheckpointId = string;
export type SequenceNum = number;

export function newWorkflowId(prefix = "wf"): WorkflowId {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function newRunId(prefix = "run"): RunId {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function newIncidentId(prefix = "inc"): IncidentId {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function newCheckpointId(prefix = "cp"): CheckpointId {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
