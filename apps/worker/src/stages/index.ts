import { STAGE_STATUS, type Stage } from "@mellodifai/shared";
import type { StageRegistry } from "../loop.js";
import { art } from "./art.js";
import { draftLyrics } from "./draft-lyrics.js";
import { generateSong } from "./generate-song.js";
import { publish, setPrivacy } from "./publish.js";
import { qa } from "./qa.js";
import { renderHook, renderMaster } from "./render.js";
import { stems } from "./stems.js";
import { storyboard } from "./storyboard.js";
import { timing } from "./timing.js";
import { visualizer } from "./visualizer.js";
export const stages: StageRegistry = {
  draft_lyrics: draftLyrics,
  generate_song: generateSong,
  timing,
  storyboard,
  render_master: renderMaster,
  render_hook: renderHook,
  qa,
  art,
  publish,
  set_privacy: setPrivacy,
  stems,
  visualizer,
};
for (const stage of Object.keys(STAGE_STATUS) as Stage[]) {
  const handler = stages[stage];
  const status = STAGE_STATUS[stage];
  if (handler && status)
    stages[stage] = async (context) => {
      const result = await handler(context);
      return result.retryLater ? result : { ...result, versionStatus: status };
    };
}
