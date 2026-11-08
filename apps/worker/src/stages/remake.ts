// "Rifai da YouTube" (master design 8.3 and 8.4, task 27): R1 ingest, R2 analyse and R3 rewrite
// as jobs of the remake's version. The work itself is packages/remake; these stages only run it,
// report progress, keep the remake row up to date, store the cost per stage and turn failures
// into codes the create panel can explain (a private video, the OpenRouter privacy filter).
// Runtime files live in <MELLODIFAI_ROOT>/remakes/<videoId>/ (E:, never C:); the package
// deletes the source media once the analysis passed.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  analyse,
  type Client,
  checkLyrics,
  costLine,
  type Env,
  envFromValues,
  ingest,
  LabseEmbedder,
  type Models,
  modelsFromEnv,
  RedactionError,
  RemakeError,
  type RewriteDeps,
  type RewriteOptions,
  remakesRoot,
  rewrite,
  rewriteSection,
} from "@mellodifai/remake";
import {
  type IngestManifest,
  type RemakeAnalysis,
  RemakeAnalysisSchema,
  type RemakeErrorCode,
  type RemakeLyrics,
  RemakeLyricsSchema,
  summarizeAnalysis,
} from "@mellodifai/shared";
import type { Remake } from "../db.js";
import type { StageContext, StageHandler, StageRegistry } from "../loop.js";
import { remakeProviderClient } from "../providers/openrouter.js";

type Embedder = { name: string; embed: RewriteDeps["embed"]; close(): void };

// What the stages use of packages/remake; the e2e worker and the tests pass fakes.
export type RemakeEngine = {
  client(env: Env, signal: AbortSignal, context: StageContext): Client;
  embedder(): Embedder;
  ingest(
    url: string,
    options: {
      env: Env;
      outRoot: string;
      signal: AbortSignal;
      log: (line: string) => void;
    },
  ): Promise<IngestManifest>;
  analyse(
    dir: string,
    options: {
      env: Env;
      client: Client;
      models: Models;
      signal: AbortSignal;
      log: (line: string) => void;
    },
  ): Promise<RemakeAnalysis>;
  rewrite(
    analysis: RemakeAnalysis,
    options: RewriteOptions,
    deps: RewriteDeps,
  ): Promise<RemakeLyrics>;
  rewriteSection(
    analysis: RemakeAnalysis,
    lyrics: RemakeLyrics,
    sectionId: string,
    options: RewriteOptions,
    deps: RewriteDeps,
  ): Promise<RemakeLyrics>;
  checkLyrics(
    analysis: RemakeAnalysis,
    lyrics: RemakeLyrics,
    edits: NonNullable<Remake["pending"]>,
    options: RewriteOptions,
    deps: RewriteDeps,
  ): Promise<RemakeLyrics>;
};

export const packageEngine: RemakeEngine = {
  client: remakeProviderClient,
  embedder() {
    if (!LabseEmbedder.available())
      throw new Error(
        "LaBSE is not installed (E:/mellodifai/venvs/labse): the originality gate cannot run",
      );
    const labse = new LabseEmbedder();
    return { name: labse.name, embed: labse.embed, close: () => labse.close() };
  },
  ingest: (url, options) => ingest(url, options),
  analyse: (dir, options) => analyse(dir, options),
  rewrite,
  rewriteSection,
  checkLyrics,
};

// The hard cap of one rewrite run, analysis included (design 8.1 standard tier: 0.25 per video);
// the target is 0.05 for the analysis plus one round.
const COST_CAP_USD = 0.12;

// Package log lines to progress: [prefix, percent, step key the studio translates].
const STEPS: [RegExp, number, string][] = [
  [/^ingest: metadata/u, 4, "ingest.metadata"],
  [/^ingest: captions/u, 10, "ingest.captions"],
  [/^ingest: audio/u, 18, "ingest.audio"],
  [/^ingest: low-res video/u, 40, "ingest.video"],
  [/^ingest: Whisper/u, 55, "ingest.transcript"],
  [/^ingest: scene-cut frames/u, 65, "ingest.frames"],
  [/^ingest: 1 fps contact sheets/u, 80, "ingest.sheets"],
  [/^analyse: Demucs/u, 8, "analyse.stems"],
  [/^analyse: beats/u, 45, "analyse.beats"],
  [/^analyse: structure/u, 58, "analyse.structure"],
  [/^analyse: key/u, 70, "analyse.key"],
  [/^final pass/u, 60, "rewrite.final"],
  [/^round \d+:/u, 90, "rewrite.jury"],
];

function reporter(context: StageContext) {
  return (line: string) => {
    void context.log(line);
    const step = STEPS.find(([pattern]) => pattern.test(line));
    if (step) void context.progress(step[1], step[2]).catch(() => {});
  };
}

function envOf(context: StageContext): Env {
  return envFromValues(context.secrets.values, {
    redact: (text) => context.secrets.redact(text),
  });
}

function codeOf(error: unknown): RemakeErrorCode {
  if (error instanceof RemakeError) return error.code;
  if (error instanceof RedactionError) return "privacy_filter";
  return "failed";
}

async function remakeOf(context: StageContext): Promise<Remake> {
  const remake = await context.db.getRemakeByVersion(context.version.id);
  if (!remake) throw new Error("remake row missing for this song");
  return remake;
}

async function readAnalysis(dir: string): Promise<RemakeAnalysis | null> {
  const path = join(dir, "analysis.json");
  if (!existsSync(path)) return null;
  const parsed = RemakeAnalysisSchema.safeParse(
    JSON.parse(await readFile(path, "utf8")),
  );
  return parsed.success ? parsed.data : null;
}

// Runs one stage; a failure is stored on the remake as a code and a short message, then
// rethrown so the job fails (a review step keeps the remake in review, see keepsStatusOnFailure).
function guarded(
  run: (context: StageContext, remake: Remake) => ReturnType<StageHandler>,
  options: { review?: (context: StageContext) => boolean } = {},
): StageHandler {
  return async (context) => {
    const remake = await remakeOf(context);
    if (remake.stage === "cancelled" || remake.stage === "accepted") return {};
    try {
      return await run(context, remake);
    } catch (error) {
      // A cancelled job writes nothing: the remake is already cancelled.
      if (context.signal.aborted) throw error;
      const message = context.secrets
        .redact(error instanceof Error ? error.message : String(error))
        .slice(0, 2000);
      const review = options.review?.(context) ?? false;
      await context.db.patchRemake(remake.id, {
        ...(review ? {} : { stage: "failed" }),
        error_code: codeOf(error),
        error: message,
      });
      throw error;
    }
  };
}

function licenceOf(license: string | null): string {
  if (!license) return "unknown";
  return /creative commons attribution/iu.test(license) ? "cc-by" : "unknown";
}

export function remakeStages(
  engine: RemakeEngine = packageEngine,
  // Where each video's folder goes: <root>/<videoId> (default <MELLODIFAI_ROOT>/remakes).
  options: { root?: string } = {},
): StageRegistry {
  const root = options.root ?? remakesRoot();
  const dirOf = (remake: Remake) => join(root, remake.video_id);
  // R1: the source on disk, unless an earlier remake of the same video already analysed it.
  const remakeIngest = guarded(async (context, remake) => {
    const report = reporter(context);
    let source: Record<string, unknown>;
    const known = await readAnalysis(dirOf(remake));
    if (known) {
      report("ingest: analysis already on file, nothing to download");
      source = { title: known.title, durationS: known.music.durationS };
    } else {
      await context.progress(2, "ingest.metadata");
      const manifest = await engine.ingest(remake.url, {
        env: envOf(context),
        outRoot: root,
        signal: context.signal,
        log: report,
      });
      source = {
        title: manifest.title,
        uploader: manifest.uploader,
        durationS: manifest.durationS,
        licence: licenceOf(manifest.license),
        language: manifest.language,
        lines: manifest.transcript.lines.length,
      };
      if (manifest.transcript.lines.length === 0)
        throw new RemakeError(
          "no_lyrics",
          "no captions and no transcript: the video has no sung lyrics to rewrite",
        );
    }
    await context.progress(95, "ingest.done");
    await context.db.patchRemake(remake.id, {
      stage: "analyse",
      source,
      error_code: null,
      error: null,
    });
    const title = String(source.title ?? "").trim();
    await context.db.patchProject(context.project.id, {
      ...(title ? { topic: title.slice(0, 500) } : {}),
      source: {
        ...(context.project.source ?? { kind: "remake" }),
        kind: "remake",
        licence: String(source.licence ?? "unknown"),
      },
    });
    return {
      enqueue: [
        {
          stage: "remake_analyse",
          idempotencyKey: `remake_analyse:${remake.id}:${context.job.id}`,
        },
      ],
    };
  });

  // R2: music, structure, lines, meaning map and blueprint; the source media go after it.
  const remakeAnalyse = guarded(async (context, remake) => {
    const report = reporter(context);
    const env = envOf(context);
    const dir = dirOf(remake);
    let analysis = await readAnalysis(dir);
    let spent = remake.cost.analysisUsd ?? 0;
    if (analysis) {
      const payerPath = join(dir, "analysis-payer.txt");
      const payer = existsSync(payerPath)
        ? await readFile(payerPath, "utf8")
        : "";
      if (payer === remake.id) spent = analysis.cost.usd;
      report("analyse: analysis already on file");
    } else {
      await context.progress(3, "analyse.stems");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "analysis-payer.txt"), remake.id);
      const client = engine.client(env, context.signal, context);
      analysis = await engine.analyse(dir, {
        env,
        client,
        models: modelsFromEnv(env.get),
        signal: context.signal,
        log: report,
      });
      spent = analysis.cost.usd;
      await context.log(`analysis cost: ${costLine(analysis.cost)}`);
    }
    if (analysis.lines.length === 0)
      throw new RemakeError(
        "no_lyrics",
        "the analysis found no sung lines to rewrite",
      );
    await context.progress(95, "analyse.done");
    await context.db.patchRemake(remake.id, {
      stage: "rewrite",
      analysis: summarizeAnalysis(analysis),
      cost: { ...remake.cost, analysisUsd: spent },
      error_code: null,
      error: null,
    });
    return {
      enqueue: [
        {
          stage: "remake_rewrite",
          idempotencyKey: `remake_rewrite:${remake.id}:${context.job.id}`,
        },
      ],
    };
  });

  const isReviewStep = (context: StageContext) => {
    const mode = context.job.payload?.mode;
    return mode === "section" || mode === "check";
  };

  // R3, and the review's two steps: one section again, or the gates on the person's edits.
  const remakeRewrite = guarded(
    async (context, remake) => {
      const report = reporter(context);
      const env = envOf(context);
      const analysis = await readAnalysis(dirOf(remake));
      if (!analysis)
        throw new Error("analysis.json is missing: run the analysis again");
      const mode = String(context.job.payload?.mode ?? "full");
      const options: RewriteOptions = {
        lang: remake.lang,
        country: remake.country,
        models: modelsFromEnv(env.get),
        costCapUsd: COST_CAP_USD,
        log: report,
      };
      const client = engine.client(env, context.signal, context);
      const embedder = engine.embedder();
      const deps: RewriteDeps = {
        client,
        embed: embedder.embed,
        embedder: embedder.name,
      };
      try {
        if (mode === "full") {
          await context.progress(5, "rewrite.write");
          const pricedAnalysis = {
            ...analysis,
            cost: { ...analysis.cost, usd: remake.cost.analysisUsd ?? 0 },
          };
          const lyrics = await engine.rewrite(pricedAnalysis, options, deps);
          await context.log(`lyrics cost: ${costLine(lyrics.cost)}`);
          await store(
            remake,
            lyrics,
            { rewriteUsd: lyrics.cost.usd },
            { stage: "review", error_code: null, error: null },
          );
          await context.progress(100, "rewrite.done");
          return {};
        }
        const current = RemakeLyricsSchema.parse(remake.lyrics);
        if (mode === "section") {
          const section = String(context.job.payload?.section ?? "");
          await context.progress(5, "rewrite.section");
          const before = current.cost.usd;
          const lyrics = await engine.rewriteSection(
            analysis,
            current,
            section,
            options,
            deps,
          );
          const delta = Math.max(0, lyrics.cost.usd - before);
          await context.log(`section ${section} cost: ${delta.toFixed(4)} USD`);
          await store(remake, lyrics, {
            sectionsUsd: (remake.cost.sectionsUsd ?? 0) + delta,
          });
          await context.progress(100, "rewrite.done");
          return {};
        }
        if (mode === "check") {
          await context.progress(10, "rewrite.check");
          // The person may edit again while this runs: apply what is pending now and write only
          // if no newer edit arrived (that one has its own check job queued).
          for (let attempt = 0; attempt < 3; attempt++) {
            const fresh = (await context.db.getRemakeByVersion(
              context.version.id,
            )) as Remake;
            if (!fresh.pending) return {};
            const lyrics = await engine.checkLyrics(
              analysis,
              RemakeLyricsSchema.parse(fresh.lyrics),
              fresh.pending,
              options,
              deps,
            );
            const wrote = await context.db.patchRemake(
              fresh.id,
              {
                lyrics,
                pending: null,
                revision: fresh.revision + 1,
              },
              fresh.revision,
            );
            if (wrote) {
              await context.progress(100, "rewrite.done");
              return {};
            }
          }
          throw new Error("the lyrics kept changing while they were checked");
        }
        throw new Error(`unknown remake_rewrite mode ${mode}`);
      } catch (error) {
        // A failed run was still paid for: its calls go on the remake's ledger.
        if (client.ledger.usd > 0) {
          const fresh = await context.db.getRemakeByVersion(context.version.id);
          await context.db.patchRemake(remake.id, {
            cost: {
              ...(fresh?.cost ?? remake.cost),
              failedUsd:
                Math.round(
                  ((fresh?.cost.failedUsd ?? 0) + client.ledger.usd) * 1e6,
                ) / 1e6,
            },
          });
          await context.log(
            `failed run cost: ${costLine(client.ledger.toJSON())}`,
          );
        }
        throw error;
      } finally {
        embedder.close();
      }

      // Stores new lyrics with a new revision, keeping edits that arrived meanwhile pending
      // (their check job follows and applies them on top).
      async function store(
        row: Remake,
        lyrics: RemakeLyrics,
        cost: Record<string, number>,
        extra: Partial<Remake> = {},
      ) {
        const dir = dirOf(row);
        await writeFile(
          join(dir, `lyrics.${row.lang}.json`),
          JSON.stringify(lyrics, null, 1),
        ).catch(() => {});
        await writeFile(
          join(dir, `lyrics.${row.lang}.txt`),
          `${lyrics.title}\n\n${lyrics.lyricsText}\n`,
        ).catch(() => {});
        let current = row;
        for (let attempt = 0; attempt < 5; attempt++) {
          if (
            await context.db.patchRemake(
              current.id,
              {
                ...extra,
                lyrics,
                revision: current.revision + 1,
                cost: { ...current.cost, ...cost },
              },
              current.revision,
            )
          )
            return;
          current = (await context.db.getRemakeByVersion(
            context.version.id,
          )) as Remake;
        }
        throw new Error("the remake kept changing while the lyrics were saved");
      }
    },
    { review: isReviewStep },
  );

  return {
    remake_ingest: remakeIngest,
    remake_analyse: remakeAnalyse,
    remake_rewrite: remakeRewrite,
  };
}
