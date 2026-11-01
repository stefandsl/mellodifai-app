import {
  LANGS,
  type Lang,
  type LocalSongEngine,
  SONG_ENGINES,
  type SongEngine,
} from "@mellodifai/shared";
import { z } from "zod";

import { st, stf } from "./i18n";

// What the worker publishes in workers.engines for each local engine.
export type EngineInfo = {
  installed: boolean;
  passedLangs: Lang[];
  minutesPerAudioMinute: number;
};
export type EngineMap = Partial<Record<LocalSongEngine, EngineInfo>>;

// A worker counts as present for local engines while its heartbeat is at most 60 s old.
export const WORKER_FRESH_MS = 60_000;
// The length the cost estimate assumes when the song has no chosen duration.
export const DEFAULT_MINUTES = 3.5;

const LOCAL: LocalSongEngine[] = ["ace-step", "yue2"];

const EntrySchema = z.object({
  installed: z.boolean(),
  passedLangs: z.array(z.enum(LANGS)),
  minutesPerAudioMinute: z.number().positive(),
});

export function isLocal(engine: string): engine is LocalSongEngine {
  return (LOCAL as string[]).includes(engine);
}

// The reading of the worker row's jsonb: unknown engines and malformed entries are ignored,
// so a half-written row never breaks the form.
export function parseEngines(raw: unknown): EngineMap {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const result: EngineMap = {};
  for (const engine of LOCAL) {
    const parsed = EntrySchema.safeParse(
      (raw as Record<string, unknown>)[engine],
    );
    if (parsed.success) result[engine] = parsed.data;
  }
  return result;
}

/** The engine stored on a project or form, kie when missing or unknown. */
export function engineOf(
  settings: Record<string, unknown> | undefined,
): SongEngine {
  const value = settings?.engine;
  return (SONG_ENGINES as readonly unknown[]).includes(value)
    ? (value as SongEngine)
    : "kie";
}

export type EngineContext = {
  isAdmin: boolean;
  engines: EngineMap;
  lastSeen: string | null;
  languages: Lang[];
  now: number;
};

export type Unavailable = "admin" | "installed" | "offline" | "lang";

// Why a local engine cannot be used right now, or null when it can (kie always can).
export function unavailableReason(
  engine: SongEngine,
  context: EngineContext,
): Unavailable | null {
  if (!isLocal(engine)) return null;
  if (!context.isAdmin) return "admin";
  const info = context.engines[engine];
  if (!info?.installed) return "installed";
  if (
    !context.lastSeen ||
    context.now - Date.parse(context.lastSeen) > WORKER_FRESH_MS
  )
    return "offline";
  if (!context.languages.every((code) => info.passedLangs.includes(code)))
    return "lang";
  return null;
}

// kie first, then each local engine that qualifies.
export function engineOptions(context: EngineContext): SongEngine[] {
  return SONG_ENGINES.filter(
    (engine) => unavailableReason(engine, context) === null,
  );
}

export function engineLabel(lang: "it" | "en", engine: SongEngine): string {
  if (engine === "kie") return "Suno (kie)";
  const suffix = lang === "it" ? "locale" : "local";
  return `${engine === "ace-step" ? "ACE-Step" : "YuE2"} · ${suffix}`;
}

export function engineName(engine: SongEngine): string {
  return engine === "kie"
    ? "Suno (kie)"
    : engine === "ace-step"
      ? "ACE-Step"
      : "YuE2";
}

// YuE2 stops on its own, so its length never follows the form; ACE-Step honours a chosen duration.
export function expectedMinutes(
  engine: SongEngine,
  durationSeconds: number | null | undefined,
): number {
  if (engine === "yue2" || !durationSeconds) return DEFAULT_MINUTES;
  return durationSeconds / 60;
}

// Minutes the PC needs for the whole generation (both takes), or null without a report.
export function localCost(
  engine: SongEngine,
  engines: EngineMap,
  durationSeconds: number | null | undefined,
): number | null {
  if (!isLocal(engine)) return null;
  const info = engines[engine];
  if (!info) return null;
  return Math.max(
    1,
    Math.round(
      info.minutesPerAudioMinute * expectedMinutes(engine, durationSeconds),
    ),
  );
}

export function minutesPhrase(lang: "it" | "en", minutes: number): string {
  if (lang === "it") return minutes === 1 ? "1 minuto" : `${minutes} minuti`;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

// Which create-form controls an engine uses. Local engines have no Suno model menu and none of
// the kie tuning sliders or the exclude field; only ACE-Step follows a chosen duration.
// The seed is for local engines; steps and guidance ("Esperto") are ACE-Step's own.
export function engineControls(engine: SongEngine) {
  return {
    model: engine === "kie",
    tuning: engine === "kie",
    duration: engine !== "yue2",
    seed: isLocal(engine),
    expert: engine === "ace-step",
  };
}

// kie charges 12 credits per song, when the lyrics are approved.
export const KIE_CREDITS_PER_SONG = 12;
export function kieCredits(songs: number): number {
  return songs * KIE_CREDITS_PER_SONG;
}
// One click makes `count` projects, and each makes one song per language.
export function songsTotal(count: number, languages: number): number {
  return count * Math.max(1, languages);
}

// A song generated on the PC: no credits, the minutes the worker reported (null if it did not).
export type LocalCost = { engine: LocalSongEngine; minutes: number | null };

// The cost sentence of the song page's confirmation windows for a local song.
export function localCostSentence(lang: "it" | "en", cost: LocalCost): string {
  return cost.minutes === null
    ? st(lang, "project.costLocalNoEstimate")
    : stf(lang, "project.costLocal", { m: minutesPhrase(lang, cost.minutes) });
}
