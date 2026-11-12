"use server";
import { headers } from "next/headers";
import { audioKeepForVisualizer } from "@/lib/ops/defs/audio-keep";
import { visualizerRequest } from "@/lib/ops/defs/visualizer-request";
import { isRemote } from "@/lib/remote";
import { runAction } from "@/lib/run-action";

export async function requestVisualizer(input: unknown) {
  return runAction(visualizerRequest, input);
}

export async function keepAudioWithVisualizer(input: unknown) {
  if (isRemote(await headers()))
    return {
      ok: false,
      code: "forbidden_scope",
      error: "Operazione non consentita",
    };
  const kept = await runAction(audioKeepForVisualizer, input);
  if (!kept.ok) return kept;
  return runAction(visualizerRequest, input);
}
