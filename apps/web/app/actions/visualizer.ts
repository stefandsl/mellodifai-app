"use server";
import { VisualizerParamsSchema } from "@mellodifai/shared";
import { z } from "zod";
import { runAction } from "@/lib/run-action";

const RequestVisualizerInput = z.object({
  versionId: z.string().uuid(),
  params: VisualizerParamsSchema,
});
const KeepAudioVisualizerInput = RequestVisualizerInput.extend({
  takeId: z.string().uuid(),
});

// "Renderizza video (MP4)": stores the studio's look on the song's visualizer render for that
// aspect and queues it on the render PC (free, local). Returns the job id.
export async function requestVisualizer(input: unknown) {
  return runAction(async (db) => {
    const v = RequestVisualizerInput.parse(input);
    const { data, error } = await db.rpc("request_visualizer", {
      p_version: v.versionId,
      p_params: v.params,
    });
    if (error) throw error;
    return { versionId: v.versionId, id: String(data) };
  });
}

// A song made with the Video card set to "Visualizer": picking the take keeps the audio and
// queues the visualizer with the look chosen in the studio.
export async function keepAudioWithVisualizer(input: unknown) {
  return runAction(async (db) => {
    const v = KeepAudioVisualizerInput.parse(input);
    const kept = await db.rpc("keep_audio", {
      p_version: v.versionId,
      p_take: v.takeId,
    });
    if (kept.error) throw kept.error;
    const { data, error } = await db.rpc("request_visualizer", {
      p_version: v.versionId,
      p_params: v.params,
    });
    if (error) throw error;
    return { versionId: v.versionId, id: String(data) };
  });
}
