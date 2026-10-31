import type { StageRegistry } from "../loop.js";
import { art } from "./art.js";
import { draftLyrics } from "./draft-lyrics.js";
import { generateSong } from "./generate-song.js";
import { publish, setPrivacy } from "./publish.js";
import { qa } from "./qa.js";
import { renderHook, renderMaster } from "./render.js";
import { storyboard } from "./storyboard.js";
import { timing } from "./timing.js";
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
};
