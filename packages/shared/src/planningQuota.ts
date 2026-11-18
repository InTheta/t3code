import type { ModelSelection, ServerProvider } from "@t3tools/contracts";

const MAX_SNAPSHOT_AGE_MS = 15 * 60 * 1000;
const HIGH_USAGE_PERCENT = 90;

export function planningQuota(provider: ServerProvider | undefined, model: string, now: number) {
  const limits = provider?.usageLimits;
  const checkedAt = Date.parse(limits?.checkedAt ?? "");
  if (
    !limits ||
    limits.unavailable ||
    !(now >= checkedAt && now - checkedAt <= MAX_SNAPSHOT_AGE_MS)
  ) {
    return { kind: "unknown" } as const;
  }
  if (limits.zeroSpendCap) {
    return { kind: "limited", label: "Spend cap", usedPercent: null, resetsAt: undefined } as const;
  }
  const window = limits.windows
    .filter(
      (entry) =>
        (!entry.modelIds || entry.modelIds.includes(model)) &&
        (!entry.providerIds || entry.providerIds.includes(model.split("/")[0] ?? "")) &&
        !(
          provider?.driver === "codex" &&
          entry.id === "individual" &&
          limits.windows.some((other) => other.id === "primary" || other.id === "secondary")
        ) &&
        (!entry.resetsAt || Date.parse(entry.resetsAt) > now),
    )
    .sort((left, right) => right.usedPercent - left.usedPercent)[0];
  if (!window) return { kind: "unknown" } as const;
  return window.usedPercent >= HIGH_USAGE_PERCENT
    ? ({
        kind: "limited",
        label: window.label,
        usedPercent: window.usedPercent,
        resetsAt: window.resetsAt,
      } as const)
    : ({ kind: "available" } as const);
}

export function lowEffortInventoryTargets(
  providers: ReadonlyArray<ServerProvider>,
  planner: ModelSelection,
) {
  return providers
    .filter(
      (provider) =>
        provider.enabled &&
        provider.installed &&
        provider.status === "ready" &&
        provider.auth.status !== "unauthenticated",
    )
    .flatMap((provider) =>
      provider.models.flatMap((model) => {
        if (
          model.isLegacy ||
          (provider.instanceId === planner.instanceId && model.slug === planner.model) ||
          !/(haiku|mini|flash)/i.test(model.slug)
        )
          return [];
        const effort = model.capabilities?.optionDescriptors?.find(
          (option) =>
            option.type === "select" &&
            (option.role === "reasoning" ||
              option.id === "effort" ||
              option.id === "reasoningEffort") &&
            option.options.some((choice) => choice.id === "low"),
        );
        return [
          {
            providerInstanceId: provider.instanceId,
            model: model.slug,
            options: effort ? [{ id: effort.id, value: "low" }] : [],
          },
        ];
      }),
    );
}
