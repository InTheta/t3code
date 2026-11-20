import type { ScopedProjectRef } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { readProject } from "../state/entities";
import { readEnvironment } from "../state/environments";
import { hasExplicitComposerModelSelection } from "./chatThreadActions";

/**
 * Gives a draft that moved project or machine the model a new thread there would start with.
 * Fork rule: this never switches provider by itself. When the default provider is out of usage the
 * composer offers the fallback for explicit approval (see modelFallbackBannerItem).
 */
export function seedDraftModelSelection(draftId: DraftId, projectRef: ScopedProjectRef): void {
  const store = useComposerDraftStore.getState();
  if (hasExplicitComposerModelSelection(store.getComposerDraft(draftId))) return;
  store.applyStickyState(draftId);
  const project = readProject(projectRef);
  const settings = readEnvironment(projectRef.environmentId)?.serverConfig?.settings;
  const defaultSelection = settings
    ? resolveProjectSettings(settings, projectRef.projectId, project ?? undefined).settings
        .defaultModelSelection
    : (project?.defaultModelSelection ?? null);
  if (defaultSelection)
    store.setModelSelection(draftId, defaultSelection, { replaceOptions: true });
}
