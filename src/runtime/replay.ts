import { FailureClass } from "../core/errors.ts";
import { ExecutionState, RunState } from "../core/state.ts";
import { RunId, WorkflowId } from "../core/types.ts";
import { JournalEntry } from "../store/traits.ts";

export class ReplayEngine {
  static replayFromJournal(runId: RunId, workflowId: WorkflowId, entries: JournalEntry[]): ExecutionState {
    const state: ExecutionState = {
      runId,
      workflowId,
      runState: RunState.Pending,
      nodeStates: {},
      nodeOutputs: {},
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attemptCounts: {},
      idempotencyKeys: [],
    };

    for (const entry of entries) {
      switch (entry.eventType) {
        case "RunStarted":
          state.runState = RunState.Running;
          state.startedAt = entry.timestamp;
          break;
        case "RunCompleted":
          state.runState = RunState.Completed;
          break;
        case "RunFailed":
          state.runState = RunState.Failed;
          break;
        case "NodeScheduled":
          if (entry.nodeId) {
            state.nodeStates[entry.nodeId] = { status: "Scheduled" };
          }
          break;
        case "NodeStarted":
          if (entry.nodeId) {
            state.nodeStates[entry.nodeId] = { status: "Running" };
            state.attemptCounts[entry.nodeId] = (state.attemptCounts[entry.nodeId] || 0) + 1;
          }
          break;
        case "NodeCompleted":
          if (entry.nodeId) {
            state.nodeStates[entry.nodeId] = { status: "Completed" };
            if (entry.payload !== null && entry.payload !== undefined) {
              state.nodeOutputs[entry.nodeId] = entry.payload;
            }
          }
          break;
        case "NodeFailed":
          if (entry.nodeId) {
            state.nodeStates[entry.nodeId] = {
              status: "Failed",
              error: (entry.payload as any) || {
                failureClass: FailureClass.ToolCallFailure,
                message: "Node execution failed",
                timestamp: entry.timestamp,
              },
            };
          }
          break;
        case "NodeRetrying":
          if (entry.nodeId) {
            const attempt = (entry.payload as any)?.attempt || 1;
            state.attemptCounts[entry.nodeId] = attempt;
            state.nodeStates[entry.nodeId] = { status: "Scheduled" };
          }
          break;
        case "CompensationStarted":
          state.runState = RunState.Recovering;
          break;
        case "CompensationCompleted":
          if (entry.nodeId) {
            state.nodeStates[entry.nodeId] = { status: "Compensated" };
          }
          break;
        case "RecoveryStarted":
          state.runState = RunState.Recovering;
          break;
        case "RecoveryCompleted":
          state.runState = RunState.Running;
          break;
      }
      state.updatedAt = entry.timestamp;
    }

    return state;
  }
}
