import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import { planningQuota, lowEffortInventoryTargets } from "@t3tools/shared/planningQuota";
import type { PlanOnlyDispatch } from "./useComposerSend";

type LimitedQuota = Extract<ReturnType<typeof planningQuota>, { kind: "limited" }>;

export type PlanOnlyProposal = {
  readonly dispatch: PlanOnlyDispatch | null;
  readonly warning?: {
    readonly current: string;
    readonly quota: LimitedQuota;
    readonly replacement: string | null;
  };
};

export function planOnlyProposal(
  providers: ReadonlyArray<ServerProvider>,
  current: ModelSelection,
  allowAccountSwitch: boolean,
  disabledReason: (instanceId: ModelSelection["instanceId"], model: string) => string | null,
  now: number,
): PlanOnlyProposal {
  const provider = providers.find((entry) => entry.instanceId === current.instanceId);
  if (!provider || !["codex", "claudeAgent"].includes(provider.driver)) return { dispatch: null };

  // Keep the native model choice unless this account advertises a stronger planning tier.
  const premium = provider.models.find((model) =>
    provider.driver === "codex" ? /astra/i.test(model.slug) : /opus/i.test(model.slug),
  );
  const effort = premium?.capabilities?.optionDescriptors?.find(
    (option) =>
      option.type === "select" &&
      (option.role === "reasoning" || option.id === "effort" || option.id === "reasoningEffort") &&
      option.options.some((choice) => choice.id === "max" || choice.id === "high"),
  );
  const preferredEffort =
    effort?.type === "select" && effort.options.some((choice) => choice.id === "max")
      ? "max"
      : "high";
  const planner =
    premium && !disabledReason(provider.instanceId, premium.slug)
      ? {
          instanceId: provider.instanceId,
          model: premium.slug,
          ...(effort ? { options: [{ id: effort.id, value: preferredEffort }] } : {}),
        }
      : current;
  const quota = planningQuota(provider, planner.model, now);
  const replacement =
    quota.kind === "limited" && allowAccountSwitch
      ? providers.find(
          (entry) =>
            entry.instanceId !== provider.instanceId &&
            entry.driver === provider.driver &&
            entry.status === "ready" &&
            entry.auth.status !== "unauthenticated" &&
            entry.enabled &&
            entry.installed &&
            entry.models.some((model) => model.slug === planner.model) &&
            !disabledReason(entry.instanceId, planner.model) &&
            planningQuota(entry, planner.model, now).kind === "available",
        )
      : undefined;
  const workerProviders = providers.filter((entry) =>
    ["claudeAgent", "codex"].includes(entry.driver),
  );
  const name = (entry: ServerProvider, model: string) =>
    `${entry.displayName ?? entry.instanceId} · ${model}`;
  if (quota.kind === "limited" && !replacement) {
    return {
      dispatch: null,
      warning: { current: name(provider, planner.model), quota, replacement: null },
    };
  }
  const targetProvider = replacement ?? provider;
  const targetPlanner = { ...planner, instanceId: targetProvider.instanceId };
  const inventoryTargets = lowEffortInventoryTargets(workerProviders, targetPlanner);
  const preferred = inventoryTargets[0];
  const inventoryStatus = (target: NonNullable<typeof preferred>) =>
    planningQuota(
      providers.find((entry) => entry.instanceId === target.providerInstanceId),
      target.model,
      now,
    );
  const workerQuota = preferred ? inventoryStatus(preferred) : undefined;
  const fallbackWorker =
    workerQuota?.kind === "limited"
      ? inventoryTargets.find((target) => inventoryStatus(target).kind === "available")
      : undefined;
  // One consent covers only the proposed change. If both roles are limited, skip inventory
  // when offering a planner switch and keep the planning turn on the approved account.
  const inventoryTarget =
    workerQuota?.kind === "limited" ? (replacement ? undefined : fallbackWorker) : preferred;
  const dispatch = { planner: targetPlanner, provider: targetProvider, inventoryTarget };
  if (quota.kind === "limited") {
    return {
      dispatch,
      warning: {
        current: name(provider, planner.model),
        quota,
        replacement: name(targetProvider, planner.model),
      },
    };
  }
  if (preferred && workerQuota?.kind === "limited") {
    const preferredProvider = providers.find(
      (entry) => entry.instanceId === preferred.providerInstanceId,
    )!;
    const fallbackProvider =
      fallbackWorker &&
      providers.find((entry) => entry.instanceId === fallbackWorker.providerInstanceId);
    return {
      dispatch: fallbackProvider ? dispatch : null,
      warning: {
        current: name(preferredProvider, preferred.model),
        quota: workerQuota,
        replacement:
          fallbackWorker && fallbackProvider ? name(fallbackProvider, fallbackWorker.model) : null,
      },
    };
  }
  return { dispatch };
}
