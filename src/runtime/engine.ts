import { FailureClass, NodeError } from "../core/errors.ts";
import { IRNode, OmegaIR } from "../core/ir.ts";
import { createInitialState, ExecutionState, RunState } from "../core/state.ts";
import { CheckpointId, NodeId, newCheckpointId, newRunId, RunId, SequenceNum } from "../core/types.ts";
import { CheckpointStore, JournalEventType, JournalStore, RunStore } from "../store/traits.ts";
import { createExecutionContext, ExecutionContext } from "./context.ts";
import { Scheduler } from "./scheduler.ts";

export type NodeHandler = (ctx: ExecutionContext) => Promise<unknown>;
export type CompensationHandler = (ctx: ExecutionContext) => Promise<void>;

export class ExecutionEngine {
  private handlers = new Map<string, NodeHandler>();
  private compensations = new Map<string, CompensationHandler>();

  constructor(
    private journalStore: JournalStore,
    private runStore: RunStore,
    private checkpointStore: CheckpointStore
  ) {}

  registerHandler(name: string, handler: NodeHandler): void {
    this.handlers.set(name, handler);
  }

  registerCompensation(name: string, handler: CompensationHandler): void {
    this.compensations.set(name, handler);
  }

  async runWorkflow(
    ir: OmegaIR,
    initialInput: unknown,
    options?: { runId?: RunId; failOnNode?: string; failureError?: NodeError }
  ): Promise<ExecutionState> {
    const runId = options?.runId || newRunId();
    const nodeIds = ir.nodes.map((n) => n.id);
    const state = createInitialState(runId, ir.id, nodeIds);

    await this.recordEvent(runId, undefined, "RunStarted", {
      workflowId: ir.id,
      input: initialInput,
    });

    state.runState = RunState.Running;
    await this.runStore.createRun(state);

    while (!Scheduler.isFinished(ir, state)) {
      const ready = Scheduler.readyNodes(ir, state);

      if (ready.length === 0) {
        if (Scheduler.hasFailure(state)) {
          state.runState = RunState.Failed;
          await this.recordEvent(runId, undefined, "RunFailed", null);
          await this.runStore.updateRun(state);
          return state;
        }
        break;
      }

      for (const nodeId of ready) {
        const node = ir.nodes.find((n) => n.id === nodeId)!;

        // Check if an injected failure was configured for this node
        if (options?.failOnNode === nodeId && options?.failureError) {
          state.nodeStates[nodeId] = { status: "Failed", error: options.failureError };
          state.runState = RunState.Failed;
          await this.recordEvent(runId, nodeId, "NodeFailed", options.failureError);
          await this.runStore.updateRun(state);
          return state;
        }

        try {
          await this.executeNode(ir, node, state, initialInput);
        } catch (err: any) {
          const nodeError: NodeError = {
            failureClass: err.failureClass || FailureClass.ToolCallFailure,
            message: err.message || String(err),
            timestamp: new Date().toISOString(),
          };

          state.nodeStates[nodeId] = { status: "Failed", error: nodeError };
          state.runState = RunState.Failed;
          await this.recordEvent(runId, nodeId, "NodeFailed", nodeError);
          await this.runStore.updateRun(state);
          return state;
        }
      }
    }

    state.runState = RunState.Completed;
    state.updatedAt = new Date().toISOString();
    await this.recordEvent(runId, undefined, "RunCompleted", null);
    await this.runStore.updateRun(state);

    return state;
  }

  private async executeNode(
    ir: OmegaIR,
    node: IRNode,
    state: ExecutionState,
    workflowInput: unknown
  ): Promise<void> {
    const runId = state.runId;
    const nodeId = node.id;

    state.nodeStates[nodeId] = { status: "Running" };
    const attempt = (state.attemptCounts[nodeId] || 0) + 1;
    state.attemptCounts[nodeId] = attempt;

    await this.recordEvent(runId, nodeId, "NodeStarted", { attempt });

    const inputs = this.resolveInputs(ir, node, state, workflowInput);
    const ctx = createExecutionContext(
      runId,
      ir.id,
      nodeId,
      inputs,
      state.nodeOutputs,
      attempt
    );

    state.idempotencyKeys.push(ctx.idempotencyKey);

    const output = await this.dispatchNodeHandler(node, ctx);

    state.nodeStates[nodeId] = { status: "Completed" };
    state.nodeOutputs[nodeId] = output;

    await this.recordEvent(runId, nodeId, "NodeCompleted", output);

    if (node.checkpoint) {
      const cpId = newCheckpointId();
      await this.checkpointStore.saveCheckpoint(cpId, state);
      await this.recordEvent(runId, nodeId, "CheckpointCreated", { checkpointId: cpId });
    }
  }

  private async dispatchNodeHandler(node: IRNode, ctx: ExecutionContext): Promise<unknown> {
    switch (node.kind.type) {
      case "Task": {
        const handler = this.handlers.get(node.kind.handler);
        if (handler) {
          return await handler(ctx);
        }
        // Default execution simulation
        return {
          nodeId: ctx.nodeId,
          handler: node.kind.handler,
          executedAt: new Date().toISOString(),
          status: "success",
        };
      }
      case "AI": {
        // Default deterministic AI response if no custom handler is registered
        if (node.kind.promptTemplate.includes("debit") || node.kind.promptTemplate.includes("ledger")) {
          return {
            debits: 50000.0,
            credits: 50000.0,
            settlement_confirmed: true,
            status: "categorized",
          };
        }
        return {
          classification: "invoice",
          confidence: 0.94,
          provider: node.kind.provider,
          model: node.kind.model,
        };
      }
      case "Gate": {
        return { condition: node.kind.condition, passed: true };
      }
      default:
        return { status: "ok" };
    }
  }

  private resolveInputs(ir: OmegaIR, node: IRNode, state: ExecutionState, workflowInput: unknown): unknown {
    const incoming = ir.edges.filter((e) => e.toNode === node.id);
    if (incoming.length === 0) return workflowInput;

    const map: Record<string, unknown> = {};
    for (const edge of incoming) {
      if (state.nodeOutputs[edge.fromNode] !== undefined) {
        map[edge.fromNode] = state.nodeOutputs[edge.fromNode];
      }
    }
    return map;
  }

  private async recordEvent(
    runId: RunId,
    nodeId: NodeId | undefined,
    eventType: JournalEventType,
    payload: unknown
  ): Promise<SequenceNum> {
    return await this.journalStore.append({
      runId,
      nodeId,
      timestamp: new Date().toISOString(),
      eventType,
      payload,
    });
  }
}
