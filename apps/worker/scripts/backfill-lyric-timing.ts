import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type LyricTiming,
  type TimedWord,
  timingFromWords,
} from "@mellodifai/shared";
import { createClient } from "@supabase/supabase-js";
import { loadSecrets } from "../src/secrets.js";

// T12 backfill for takes made before "Riscrivi una parte": the timed lyric lines
// (takes.lyric_timing) from the files the pipeline already left in each song's workspace (the
// timing stage's timing.json for the chosen take, else the words score_takes.py heard), and
// kie's track id (takes.kie_audio_id) from takes.json. Only fills what is empty; run once:
// node node_modules/tsx/dist/cli.mjs scripts/backfill-lyric-timing.ts
const PROJECTS = "E:\\mellodifai\\projects";

async function json<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function main() {
  const secrets = await loadSecrets();
  const url = secrets.values.SUPABASE_URL;
  const key = secrets.values.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const db = createClient(url, key);
  const { data: versions, error } = await db
    .from("versions")
    .select(
      "id,project_id,lang,chosen_take_id,generation_count,lyric_pack,takes!takes_version_id_owner_id_fkey(id,take_number,generation,engine,lyric_timing,kie_audio_id)",
    );
  if (error) throw new Error(error.message);
  let timed = 0;
  let ids = 0;
  for (const version of versions ?? []) {
    const out = join(
      PROJECTS,
      version.project_id,
      version.lang,
      "out",
      version.lang,
    );
    const lyrics = (version.lyric_pack as { lyrics?: unknown } | null)?.lyrics;
    const timing = await json<{
      lines?: { text?: string; words?: { start: number; end: number }[] }[];
    }>(
      join(
        PROJECTS,
        version.project_id,
        version.lang,
        "public",
        "data",
        version.lang,
        "timing.json",
      ),
    );
    const kieTracks = await json<{ id?: string }[]>(join(out, "takes.json"));
    for (const take of version.takes ?? []) {
      const current = take.generation === version.generation_count;
      const patch: { lyric_timing?: LyricTiming; kie_audio_id?: string } = {};
      if (!take.lyric_timing && current) {
        if (take.id === version.chosen_take_id && timing?.lines?.length) {
          const lines = timing.lines.flatMap((line) => {
            const first = line.words?.[0];
            const last = line.words?.at(-1);
            return first && last && typeof line.text === "string"
              ? [{ text: line.text, start: first.start, end: last.end }]
              : [];
          });
          if (lines.length) patch.lyric_timing = { source: "timing", lines };
        }
        if (
          !patch.lyric_timing &&
          typeof lyrics === "string" &&
          lyrics.trim()
        ) {
          const heard = await json<TimedWord[]>(
            join(out, `take-${take.take_number}.words.json`),
          );
          const found = heard
            ? timingFromWords(lyrics, heard, "whisper")
            : null;
          if (found) patch.lyric_timing = found;
        }
      }
      if (take.engine === "kie" && !take.kie_audio_id && current && kieTracks) {
        const id = kieTracks[(take.take_number ?? 0) - 1]?.id;
        if (typeof id === "string" && id) patch.kie_audio_id = id;
      }
      if (!Object.keys(patch).length) continue;
      const { error: failed } = await db
        .from("takes")
        .update(patch)
        .eq("id", take.id);
      if (failed) throw new Error(failed.message);
      if (patch.lyric_timing) timed += 1;
      if (patch.kie_audio_id) ids += 1;
    }
  }
  console.log(`lyric timing on ${timed} takes, kie track ids on ${ids} takes`);
}

await main();
