// Fake remake engine for the e2e stack (WORKER_FAKE=1, task 27): the real remake stages run, but
// ingest and analysis return the fixture analysis and the rewrite the fixture lyrics from
// packages/remake/test/fixtures, after short pauses with the real progress steps. Edits are
// checked by the real gates (lexical checks, a deterministic stand-in for LaBSE). Nothing is
// downloaded and nothing calls OpenRouter.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  checkLyrics,
  createClient,
  Ledger,
  RemakeError,
  runtimeRoot,
} from "@mellodifai/remake";
import {
  type IngestManifest,
  type RemakeAnalysis,
  RemakeAnalysisSchema,
  type RemakeLyrics,
  RemakeLyricsSchema,
  remakeLyricsText,
} from "@mellodifai/shared";
import type { StageRegistry } from "../loop.js";
import { type RemakeEngine, remakeStages } from "../stages/remake.js";

const FIXTURES = new URL(
  "../../../../packages/remake/test/fixtures/",
  import.meta.url,
);

async function fixture<T>(name: string, parse: (v: unknown) => T): Promise<T> {
  return parse(JSON.parse(await readFile(new URL(name, FIXTURES), "utf8")));
}

// Videos that fail like real ones, for the error messages of the create panel.
const FAILING: Record<string, ConstructorParameters<typeof RemakeError>> = {
  PrivateVid0: ["private", "ERROR: [youtube] PrivateVid0: Private video"],
  AgeGated000: ["age_restricted", "ERROR: Sign in to confirm your age"],
  TooLong0000: [
    "too_long",
    "the video lasts 3600 s; a remake takes songs up to 480 s",
  ],
};

// Same text, same vector; different texts are nearly orthogonal.
function fakeEmbed(texts: string[]): Promise<number[][]> {
  return Promise.resolve(
    texts.map((text) => {
      const v = new Array<number>(32).fill(0);
      let h = 2166136261;
      for (const c of text.toLowerCase()) {
        h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        v[Math.abs(h) % 32] = (v[Math.abs(h) % 32] ?? 0) + 1;
      }
      return v;
    }),
  );
}

// New lines for "Rigenera sezione", by section kind.
const ALTERNATIVES: Record<string, string[]> = {
  verse: [
    "Togliete il bavaglio adesso",
    "Ci volete sempre zitti",
    "Mai.",
    "Io resto qui.",
    "Basta maschere ormai",
  ],
  chorus: [
    "Cento strade e nessuno si ferma",
    "Grido piano ma il cielo è lontano",
    "Batto il tempo sul cuore che trema",
    "e il mio canto non torna",
  ],
  bridge: [
    "Siamo in bilico sul buio",
    "ma la scintilla resiste",
    "Il vuoto stringe da ogni lato",
    "ma dentro canta il fuoco",
  ],
};

export function fakeRemakeEngine(
  pause: (signal: AbortSignal) => Promise<void> = (signal) =>
    setTimeout(400, undefined, { signal }),
): RemakeEngine {
  const failing = (url: string) =>
    Object.entries(FAILING).find(([id]) => url.includes(id))?.[1];
  return {
    client: () =>
      createClient({
        key: "fake",
        ledger: new Ledger(),
        fetchFn: async () => {
          throw new Error("the fake remake engine never calls OpenRouter");
        },
      }),
    embedder: () => ({ name: "fake", embed: fakeEmbed, close: () => {} }),
    async ingest(url, options) {
      for (const step of [
        "ingest: metadata",
        "ingest: captions (en)",
        "ingest: audio",
        "ingest: low-res video",
        "ingest: scene-cut frames",
        "ingest: 1 fps contact sheets",
      ]) {
        await pause(options.signal);
        options.log(step);
        const fail = failing(url);
        if (fail) throw new RemakeError(...fail);
      }
      const analysis = await fixture(
        "remake-analysis.json",
        RemakeAnalysisSchema.parse,
      );
      return {
        title: analysis.title,
        uploader: "The Sixsters",
        durationS: analysis.music.durationS,
        license: "Creative Commons Attribution license (reuse allowed)",
        language: analysis.sourceLanguage,
        transcript: {
          source: "captions",
          language: analysis.sourceLanguage,
          lines: analysis.lines.map((l) => ({
            start: l.start,
            end: l.end,
            text: l.text,
          })),
        },
      } as unknown as IngestManifest;
    },
    async analyse(dir, options) {
      for (const step of [
        "analyse: Demucs stems (CPU)",
        "analyse: beats and downbeats (beat_this)",
        "analyse: structure, meter, energy, vocal",
        "analyse: key (suno-remake tools/analyze_audio.py)",
      ]) {
        await pause(options.signal);
        options.log(step);
      }
      const videoId = dir.replaceAll("\\", "/").split("/").at(-1) ?? "";
      const analysis: RemakeAnalysis = {
        ...(await fixture("remake-analysis.json", RemakeAnalysisSchema.parse)),
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      };
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "analysis.json"),
        JSON.stringify(analysis, null, 1),
      );
      return analysis;
    },
    async rewrite(_analysis, options) {
      await pause(new AbortController().signal);
      options.log?.(
        "final pass: 12 lines polished, 0 reverted to keep the gates",
      );
      await pause(new AbortController().signal);
      options.log?.(
        "round 1: failing -, 1 blocking objections, 1 flagged and 0 misfit lines",
      );
      const lyrics = await fixture(
        "remake-lyrics.it.json",
        RemakeLyricsSchema.parse,
      );
      return {
        ...lyrics,
        lang: options.lang,
        country: options.country ?? null,
      };
    },
    async rewriteSection(_analysis, lyrics, sectionId, options) {
      await pause(new AbortController().signal);
      options.log?.(
        "final pass: 4 lines polished, 0 reverted to keep the gates",
      );
      const next: RemakeLyrics = structuredClone(lyrics);
      const section = next.sections.find((s) => s.id === sectionId);
      const pool =
        ALTERNATIVES[section?.kind ?? ""] ?? ALTERNATIVES.chorus ?? [];
      for (const [i, line] of (section?.lines ?? []).entries()) {
        line.text = pool[i % pool.length] ?? line.text;
        line.edited = undefined;
      }
      next.lyricsText = remakeLyricsText(next);
      const last = next.jury.rounds.at(-1);
      if (last)
        next.jury.rounds.push({
          ...structuredClone(last),
          round: last.round + 1,
          issues: last.issues.filter(
            (i) => !section?.lines.some((l) => l.index === i.line),
          ),
        });
      next.cost = {
        usd: Math.round((next.cost.usd + 0.0121) * 1e6) / 1e6,
        calls: [
          ...next.cost.calls,
          {
            step: "write-section",
            model: "anthropic/claude-haiku-5.5",
            usd: 0.0012,
            promptTokens: 900,
            completionTokens: 200,
            estimated: false,
          },
        ],
      };
      return next;
    },
    async checkLyrics(analysis, lyrics, edits, options, deps) {
      await pause(new AbortController().signal);
      const checked = await checkLyrics(analysis, lyrics, edits, options, {
        ...deps,
        embed: fakeEmbed,
      });
      // The stand-in embedder cannot judge meaning: keep the sections' real scores.
      checked.originality.sections = lyrics.originality.sections;
      return checked;
    },
  };
}

export function createFakeRemakeStages(): StageRegistry {
  return remakeStages(fakeRemakeEngine(), {
    root: join(runtimeRoot(), "tmp", "fake-remakes"),
  });
}
