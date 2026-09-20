import { FailureClass } from "./errors.ts";
import { Invariant } from "./invariants.ts";
import { WorkflowPolicies } from "./policies.ts";
import { WorkflowId, NodeId } from "./types.ts";

export enum SideEffectContract {
  Idempotent = "Idempotent",         // Safe to retry without side effects
  Compensatable = "Compensatable",   // Has side effects with an explicit rollback handler
  ReadOnly = "ReadOnly",             // Pure read, zero side effects
  AtMostOnce = "AtMostOnce",         // Must not blindly retry
}

export type BackoffStrategy =
  | { type: "Fixed"; delayMs: number }
  | { type: "Exponential"; initialMs: number; maxMs: number; multiplier: number }
  | { type: "Linear"; delayMs: number; incrementMs: number };

export interface RetryPolicy {
  maxAttempts: number;
  backoff: BackoffStrategy;
  retryOn: FailureClass[];
}

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  backoff: { type: "Exponential", initialMs: 1000, maxMs: 30000, multiplier: 2.0 },
  retryOn: [FailureClass.NetworkTransient, FailureClass.RateLimit],
};

export type NodeKind =
  | { type: "Task"; handler: string }
  | {
      type: "AI";
      provider: string;
      model: string;
      promptTemplate: string;
      outputSchema?: Record<string, unknown>;
      budget?: { maxTokens?: number; maxCostUsd?: number };
    }
  | { type: "Gate"; condition: string }
  | { type: "Fork"; strategy: "All" | "Race" }
  | { type: "Join"; strategy: "All" | { anyMin: number } }
  | { type: "Approval"; approvers: string[]; timeoutSecs: number }
  | { type: "Compensation"; targetNode: NodeId };

export interface PortBinding {
  name: string;
  portType: "Json" | "String" | "Number" | "Boolean" | "Any";
}

export interface IRNode {
  id: NodeId;
  name: string;
  kind: NodeKind;
  sideEffect: SideEffectContract;
  retryPolicy: RetryPolicy;
  timeoutSecs?: number;
  checkpoint: boolean;
  inputs?: PortBinding[];
  outputs?: PortBinding[];
}

export interface IREdge {
  fromNode: NodeId;
  fromPort: string;
  toNode: NodeId;
  toPort: string;
  condition?: string;
}

export interface WorkflowMetadata {
  description?: string;
  createdAt: string;
  tags: string[];
}

export interface OmegaIR {
  id: WorkflowId;
  name: string;
  version: number;
  nodes: IRNode[];
  edges: IREdge[];
  invariants: Invariant[];
  policies: WorkflowPolicies;
  metadata: WorkflowMetadata;
}

export class IRValidator {
  static validate(ir: OmegaIR): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!ir.id) errors.push("Workflow ID is required");
    if (!ir.name) errors.push("Workflow name is required");
    if (!ir.nodes || ir.nodes.length === 0) errors.push("Workflow must contain at least one node");

    const nodeIds = new Set<string>();
    for (const node of ir.nodes || []) {
      if (nodeIds.has(node.id)) {
        errors.push(`Duplicate node ID found: ${node.id}`);
      }
      nodeIds.add(node.id);
    }

    for (const edge of ir.edges || []) {
      if (!nodeIds.has(edge.fromNode)) {
        errors.push(`Edge references non-existent source node: ${edge.fromNode}`);
      }
      if (!nodeIds.has(edge.toNode)) {
        errors.push(`Edge references non-existent target node: ${edge.toNode}`);
      }
    }

    // Cycle check via topological sort attempt
    const topo = this.topologicalOrder(ir);
    if (!topo.success) {
      errors.push(`Workflow graph contains cycles: ${topo.error}`);
    }

    return { valid: errors.length === 0, errors };
  }

  static topologicalOrder(ir: OmegaIR): { success: boolean; order?: NodeId[]; error?: string } {
    const inDegree = new Map<NodeId, number>();
    const adj = new Map<NodeId, NodeId[]>();

    for (const node of ir.nodes) {
      inDegree.set(node.id, 0);
      adj.set(node.id, []);
    }

    for (const edge of ir.edges) {
      adj.get(edge.fromNode)?.push(edge.toNode);
      inDegree.set(edge.toNode, (inDegree.get(edge.toNode) || 0) + 1);
    }

    const queue: NodeId[] = [];
    for (const [nodeId, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(nodeId);
    }

    const order: NodeId[] = [];
    while (queue.length > 0) {
      const u = queue.shift()!;
      order.push(u);

      for (const v of adj.get(u) || []) {
        const newDeg = (inDegree.get(v) || 0) - 1;
        inDegree.set(v, newDeg);
        if (newDeg === 0) queue.push(v);
      }
    }

    if (order.length !== ir.nodes.length) {
      return { success: false, error: "Cycle detected in workflow graph dependencies" };
    }

    return { success: true, order };
  }

  static getDependents(ir: OmegaIR, nodeId: NodeId): NodeId[] {
    const dependents: NodeId[] = [];
    for (const edge of ir.edges) {
      if (edge.fromNode === nodeId) {
        dependents.push(edge.toNode);
      }
    }
    return dependents;
  }
}
