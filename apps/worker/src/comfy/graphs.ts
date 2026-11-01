import { readFile } from "node:fs/promises";
import type { LocalSongEngine } from "@mellodifai/shared";
import { LOCAL_ENGINES } from "./config.js";

// API-format graphs as ComfyUI 0.43.0 accepted them in the bake-off
// (E:\mellodifai\research\bakeoff\graphs\TEMPLATE_*.api.json), committed in engines/comfy.
export type ComfyGraph = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;

export async function loadGraph(engine: LocalSongEngine): Promise<ComfyGraph> {
  const file = new URL(
    `../../engines/comfy/${LOCAL_ENGINES[engine].graph}`,
    import.meta.url,
  );
  return JSON.parse(await readFile(file, "utf8")) as ComfyGraph;
}

function fill(
  template: ComfyGraph,
  values: Record<string, Record<string, unknown>>,
): ComfyGraph {
  const graph = structuredClone(template);
  for (const [node, inputs] of Object.entries(values)) {
    const target = graph[node];
    if (!target) throw new Error(`graph node ${node} is missing`);
    Object.assign(target.inputs, inputs);
  }
  return graph;
}

// Fill map of design 5.3; the ABC temperature 0.9 is already in the template.
export function yue2Graph(
  template: ComfyGraph,
  options: {
    style: string;
    lyrics: string;
    seed: number;
    maxDuration: number;
    prefix: string;
  },
): ComfyGraph {
  const { style, lyrics, seed } = options;
  return fill(template, {
    "24": { style, lyrics, seed },
    "25": { style, lyrics, seed, max_duration: options.maxDuration },
    "8": { seed },
    "10": { filename_prefix: options.prefix },
  });
}

// Fill map of bakeoff.md section 8: 94 (text and audio codes), 98 (latent length), 3, 107.
export function aceGraph(
  template: ComfyGraph,
  options: {
    style: string;
    lyrics: string;
    seed: number;
    duration: number;
    bpm: number;
    keyscale: string;
    language: string;
    prefix: string;
    // Auto (left out) keeps the template's 4/4, 30 sampler steps and guidance 7.
    timesignature?: string;
    steps?: number;
    guidance?: number;
  },
): ComfyGraph {
  const { lyrics, seed, bpm, keyscale, language, duration } = options;
  return fill(template, {
    "94": {
      tags: options.style,
      lyrics,
      seed,
      bpm,
      duration,
      keyscale,
      language,
      ...(options.timesignature
        ? { timesignature: options.timesignature }
        : {}),
    },
    "98": { seconds: duration },
    "3": {
      seed,
      ...(options.steps === undefined ? {} : { steps: options.steps }),
      ...(options.guidance === undefined ? {} : { cfg: options.guidance }),
    },
    "107": { filename_prefix: options.prefix },
  });
}

// The keys the ACE-Step text encoder accepts (comfy_extras/nodes_ace.py, keyscale combo).
const KEYSCALES = new Set(
  ["major", "minor"].flatMap((quality) =>
    [
      "C",
      "C#",
      "Db",
      "D",
      "D#",
      "Eb",
      "E",
      "F",
      "F#",
      "Gb",
      "G",
      "G#",
      "Ab",
      "A",
      "A#",
      "Bb",
      "B",
    ].map((root) => `${root} ${quality}`),
  ),
);

// Tempo and key as the bake-off read them from the style (prep_packs.py bpm_key), within what
// the node accepts: 120 BPM and C major when the style names none.
export function bpmAndKey(style: string): { bpm: number; keyscale: string } {
  const bpm = /(\d{2,3})\s*BPM/u.exec(style);
  const key = /\b([A-G])(?:-|\s)?(flat|sharp|b|#)?\s+(major|minor)\b/iu.exec(
    style,
  );
  let keyscale = "C major";
  if (key?.[1] && key[3]) {
    const accidental =
      { flat: "b", b: "b", sharp: "#", "#": "#" }[
        (key[2] ?? "").toLowerCase()
      ] ?? "";
    const candidate = `${key[1].toUpperCase()}${accidental} ${key[3].toLowerCase()}`;
    if (KEYSCALES.has(candidate)) keyscale = candidate;
  }
  return {
    bpm: Math.min(300, Math.max(10, bpm?.[1] ? Number(bpm[1]) : 120)),
    keyscale,
  };
}

// Design 5.4: one tag per line, [Final Chorus] and [Chorus N] become [Chorus], directions after
// a colon or comma are dropped, lines that are only a parenthesis are dropped, (x2) is expanded,
// and a blank line separates sections. Port of the bake-off's prep_packs.py to_yue2_lyrics.
export function toYue2Lyrics(text: string): string {
  const out: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/u)) {
    let line = raw.trim();
    if (!line) continue;
    const tag = /^\[([^\]]+)\]$/u.exec(line);
    if (tag?.[1]) {
      let name = (tag[1].split(/[:,]/u)[0] ?? "").trim();
      if (/^(final\s+)?chorus(\s*\d+)?$/iu.test(name)) name = "Chorus";
      if (out.length) out.push("");
      out.push(`[${name}]`);
      continue;
    }
    if (/^\(.*\)$/u.test(line)) continue;
    const repeat = /\s*\(x(\d)\)\s*$/iu.exec(line);
    if (repeat?.[1]) {
      line = line.slice(0, repeat.index).trimEnd();
      for (let i = 0; i < Number(repeat[1]); i += 1) out.push(line);
      continue;
    }
    out.push(line);
  }
  return `${out.join("\n").trim()}\n`;
}
