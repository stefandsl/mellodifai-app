import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LyricPackSchema } from "@mellodifai/shared";
import type { StageHandler } from "../loop.js";
import { key, language, readJson } from "./utils.js";

type Timing = {
  duration: number;
  lines: {
    section: string;
    text: string;
    words: { start: number; end: number }[];
  }[];
};

export function songStoryboard(
  timing: Timing,
  title: string,
  lang: string,
  mood = "",
) {
  if (
    !Number.isFinite(timing.duration) ||
    timing.duration <= 0 ||
    !timing.lines?.length
  )
    throw new Error("Song timing is required for its storyboard");
  const color = /sad|dark|trist|malincon|melanchol|sombr|calm|quiet/iu.test(
    mood,
  )
    ? "ink"
    : /angry|intense|rabb|energi|tense/iu.test(mood)
      ? "alert"
      : "approve";
  const lines = timing.lines
    .map((line, index) => ({
      index,
      line,
      start: line.words?.[0]?.start ?? Number.NaN,
    }))
    .filter(
      (item) =>
        Number.isFinite(item.start) &&
        item.start >= 0 &&
        item.start < timing.duration,
    );
  if (!lines.length) throw new Error("Song timing has no sung lines");
  const shots = lines
    .map((item, i) => ({
      id: `${lang}-${String(i + 1).padStart(3, "0")}`,
      start: i === 0 ? 0 : item.start,
      end: lines[i + 1]?.start ?? timing.duration,
      lines: [item.index],
      section: item.line.section,
      scene: "kinetic",
      mood: color,
      transitionIn: "cut",
      props: {
        layout: "center",
        emphasis: [
          (item.line.text.match(/[\p{L}\p{N}]+/gu) ?? []).sort(
            (a, b) => b.length - a.length,
          )[0] ?? "",
        ].filter(Boolean),
      },
    }))
    .filter((shot) => shot.end > shot.start);
  const chorus = shots.find((shot) =>
    /chorus|ritornell|refrain/iu.test(shot.section),
  );
  const start = chorus?.start ?? 0;
  const end = Math.min(timing.duration, start + 30);
  const sections: {
    title: string;
    start: number;
    shots: { start: number; text: string }[];
  }[] = [];
  for (const shot of shots) {
    if (sections.at(-1)?.title !== shot.section)
      sections.push({ title: shot.section, start: shot.start, shots: [] });
    sections.at(-1)?.shots.push({
      start: shot.start,
      text: timing.lines[shot.lines[0] ?? 0]?.text ?? "",
    });
  }
  return {
    storyboard: {
      lang,
      title,
      acronym: Array.from(title.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 3)),
      expansion: title,
      strings: {},
      shots,
      hook: { start, end },
    },
    sections,
  };
}

export const storyboard: StageHandler = async (context) => {
  const lang = language(context);
  const pack = LyricPackSchema.parse(context.version.lyric_pack);
  const dataDir = join(context.ws.publicDir, "data", lang);
  const timing = await readJson<Timing>(join(dataDir, "timing.json"));
  const { storyboard: scenes, sections } = songStoryboard(
    timing,
    pack.title,
    lang,
    context.project.mood ??
      (context.project.song_settings as { mood?: string } | null)?.mood ??
      pack.style,
  );
  const current = join(dataDir, "storyboard.json");
  const archived = join(
    dataDir,
    `storyboard-${context.version.render_attempt ?? 1}.json`,
  );
  await writeFile(current, JSON.stringify(scenes));
  await copyFile(current, archived);
  return {
    patch: { storyboard_path: archived, storyboard_sections: sections },
    enqueue: [
      { stage: "render_master", idempotencyKey: key("render_master", context) },
    ],
  };
};
