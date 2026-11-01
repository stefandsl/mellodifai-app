"use client";

import type { SongEngine } from "@mellodifai/shared";
import { useLocale } from "@/components/locale-provider";
import { useWorkerState } from "@/components/studio/worker-state";
import {
  type EngineContext,
  engineOptions,
  unavailableReason,
} from "@/lib/studio/engines";
import { useCreateForm } from "@/store/create-form";

// The engine the form really uses: the stored choice while it still qualifies, else kie.
export function useEngineChoice() {
  const lang = useLocale();
  const worker = useWorkerState();
  const stored = useCreateForm((s) => s.engine);
  const languages = useCreateForm((s) => s.languages);
  const context: EngineContext = {
    isAdmin: worker.isAdmin,
    engines: worker.engines,
    lastSeen: worker.lastSeen,
    languages,
    now: worker.now,
  };
  const reason = unavailableReason(stored, context);
  const engine: SongEngine = reason ? "kie" : stored;
  return {
    lang,
    stored,
    engine,
    reason,
    options: engineOptions(context),
    isAdmin: worker.isAdmin,
    engines: worker.engines,
  };
}
