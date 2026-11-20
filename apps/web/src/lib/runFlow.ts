/* oxlint-disable t3code/no-untranslated-copy -- fork-only operator screen, English only */
import type { ManagedRun } from "./managedRunDelivery";

/** A step status as drawn on a flow diagram. */
export type FlowStatus = "done" | "active" | "waiting" | "blocked" | "failed" | "pending";

export interface FlowNode {
  readonly id: string;
  readonly label: string;
  readonly sub?: string | undefined;
  readonly status: FlowStatus;
  /** "decision" nodes are drawn as diamonds. */
  readonly kind: "step" | "decision";
  readonly col: number;
  readonly row: number;
  /** The stage this node stands for; selecting the node opens that stage's details. */
  readonly stageId?: string | undefined;
}

export interface FlowEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string | undefined;
  /** An edge the run actually followed is drawn solid; one it could still take, dashed. */
  readonly taken: boolean;
}

export interface Flow {
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
}

export function stageFlowStatus(status: string): FlowStatus {
  const value = status.toLowerCase();
  if (value === "waiting_for_operator") return "waiting";
  if (value === "paused_provider_quota" || value === "cancelling_quota") return "blocked";
  if (/fail|error|cancel|reject|abort|timed?_?out/.test(value)) return "failed";
  if (/complet|succe|done|pass|approved|finished|merged/.test(value)) return "done";
  if (/run|active|progress|start|working|dispatch|accept/.test(value)) return "active";
  return "pending";
}

const roles = ["lead", "implementation", "qa"] as const;
const roleLabels: Record<(typeof roles)[number], string> = {
  lead: "Lead",
  implementation: "Implementation",
  qa: "Independent QA",
};

function tokens(value: number | null): string {
  return value === null ? "unknown" : value.toLocaleString();
}

/**
 * Describe a managed run as a flow: the brief, the lead / implementation / QA stages, the
 * decisions that gate them (provider quota, QA verdict) and where the run ends up.
 */
export function buildRunFlow(run: ManagedRun): Flow {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const add = (node: FlowNode) => nodes.push(node);
  const link = (from: string, to: string, taken: boolean, label?: string) =>
    edges.push({ from, to, taken, label });

  add({
    id: "brief",
    label: "Brief",
    sub: `${tokens(run.budget.used)} of ${tokens(run.budget.reserved)} tokens`,
    status: "done",
    kind: "step",
    col: 0,
    row: 0,
  });

  let previous = "brief";
  let previousDone = true;
  roles.forEach((role, index) => {
    const stage = run.stages.find((item) => item.role.toLowerCase() === role);
    const status = stage ? stageFlowStatus(stage.status) : "pending";
    const id = `stage:${role}`;
    const stageEvents = stage
      ? (run.workflowEvents ?? []).filter((e) => e.stageId === stage.stageId)
      : [];
    const sub = stage
      ? [
          stage.status.replaceAll("_", " "),
          stageEvents.some((e) => e.kind === "symphony-controller-accepted")
            ? "controller accepted"
            : null,
          stage.toolCalls ? `${stage.toolCalls.toLocaleString()} tool calls` : null,
        ]
          .filter((part) => part !== null)
          .join(" · ")
      : "not started";
    add({
      id,
      label: roleLabels[role],
      sub,
      status,
      kind: "step",
      col: 1 + index,
      row: 0,
      stageId: stage?.stageId,
    });
    link(previous, id, previousDone && stage !== undefined);
    previous = id;
    previousDone = status === "done";

    if (stage && (status === "blocked" || status === "waiting")) {
      const decisionId = `decision:${role}`;
      const quota = status === "blocked";
      add({
        id: decisionId,
        label: quota ? "Quota reached" : "Operator needed",
        sub: quota ? "approve or decline" : "review in the thread",
        status,
        kind: "decision",
        col: 1 + index,
        row: 1,
        stageId: stage.stageId,
      });
      link(id, decisionId, true);
      link(decisionId, id, false, quota ? "approve: continue" : "answered");
      if (quota) {
        add({
          id: `stopped:${role}`,
          label: "Stopped",
          sub: "handoff declined",
          status: "pending",
          kind: "step",
          col: 1 + index,
          row: 2,
        });
        link(decisionId, `stopped:${role}`, false, "decline");
      }
    }
  });

  const verdict = run.qa?.verdict;
  const qaStatus = run.stages.find((item) => item.role.toLowerCase() === "qa");
  add({
    id: "decision:verdict",
    label: "QA verdict",
    sub: verdict
      ? (verdict === "pass" ? "passed" : "failed") +
        (run.qa?.budgetExceeded ? " · over budget" : "")
      : "not recorded",
    status: verdict === "pass" ? "done" : verdict === "fail" ? "failed" : "pending",
    kind: "decision",
    col: 4,
    row: 0,
  });
  link(
    previous,
    "decision:verdict",
    previousDone && qaStatus !== undefined && verdict !== undefined,
  );
  add({
    id: "outcome:ready",
    label: "Ready for PR",
    sub: run.status.replaceAll("_", " "),
    status: verdict === "pass" ? "done" : "pending",
    kind: "step",
    col: 5,
    row: 0,
  });
  link("decision:verdict", "outcome:ready", verdict === "pass", "pass");
  add({
    id: "outcome:rework",
    label: "Rework",
    sub: "back to implementation",
    status: verdict === "fail" ? "failed" : "pending",
    kind: "step",
    col: 4,
    row: 1,
  });
  link("decision:verdict", "outcome:rework", verdict === "fail", "fail");
  link("outcome:rework", "stage:implementation", verdict === "fail");
  return { nodes, edges };
}
