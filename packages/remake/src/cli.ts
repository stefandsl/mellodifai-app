// remake <url> [--lang it] [--country IT] [--out E:/mellodifai/remakes]
// Runs R1 ingest, R2 analyse and R3 rewrite, prints a summary and the JSON paths.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { RemakeAnalysisSchema } from "@mellodifai/shared";
import { analyse } from "./analyse.js";
import { LabseEmbedder } from "./embed.js";
import { loadEnv } from "./env.js";
import { ingest, parseVideoId } from "./ingest.js";
import { createClient, DEFAULT_MODELS, Ledger } from "./openrouter.js";
import { remakesRoot } from "./paths.js";
import { rewrite } from "./rewrite.js";

export const COST_TARGET_USD = 0.05;

export function parseCliArgs(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      lang: { type: "string", default: "it" },
      country: { type: "string" },
      out: { type: "string" },
      "source-lang": { type: "string" },
      writer: { type: "string", default: "fast" },
      rounds: { type: "string", default: "3" },
      embedder: { type: "string", default: "labse" },
      "no-stems": { type: "boolean", default: false },
      "keep-media": { type: "boolean", default: false },
      "meaning-gate": { type: "string", default: "enforce" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const url = positionals[0];
  if (values.help || !url) return { help: true as const };
  if (!parseVideoId(url)) throw new Error(`not a YouTube video link: ${url}`);
  if (values.writer !== "fast" && values.writer !== "strong")
    throw new Error("--writer is fast or strong");
  if (
    values["meaning-gate"] !== "enforce" &&
    values["meaning-gate"] !== "report"
  )
    throw new Error("--meaning-gate is enforce or report");
  if (values.embedder !== "labse" && values.embedder !== "openrouter")
    throw new Error("--embedder is labse or openrouter");
  const rounds = Number(values.rounds);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 3)
    throw new Error("--rounds is 1 to 3 (design 8.4)");
  return {
    help: false as const,
    url,
    lang: values.lang.toLowerCase(),
    country: values.country?.toUpperCase() ?? null,
    out: (values.out ?? remakesRoot()).replaceAll("\\", "/"),
    sourceLang: values["source-lang"],
    writer: values.writer as "fast" | "strong",
    rounds,
    embedder: values.embedder as "labse" | "openrouter",
    stems: !values["no-stems"],
    keepMedia: values["keep-media"],
    meaningGate: values["meaning-gate"] as "enforce" | "report",
    force: values.force,
  };
}

const USAGE = `remake <youtube url> [--lang it] [--country IT] [--out E:/mellodifai/remakes]
  [--source-lang en] [--writer fast|strong] [--rounds 1-3] [--embedder labse|openrouter]
  [--meaning-gate enforce|report] [--no-stems] [--keep-media] [--force]`;

export async function main(argv: string[]): Promise<number> {
  const args = parseCliArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const env = await loadEnv();
  const log = (line: string) => console.log(env.redact(line));
  const ledger = new Ledger();
  const client = createClient({
    key: env.require("OPENROUTER_API_KEY"),
    ledger,
  });
  const videoId = parseVideoId(args.url) ?? "";
  const dir = `${args.out}/${videoId}`;
  const analysisPath = join(dir, "analysis.json");

  let analysis = null;
  if (!args.force && existsSync(analysisPath)) {
    analysis = RemakeAnalysisSchema.parse(
      JSON.parse(await readFile(analysisPath, "utf8")),
    );
    log(`analysis: reusing ${analysisPath}`);
  } else {
    const manifest = await ingest(args.url, {
      outRoot: args.out,
      env,
      log,
      force: args.force,
      ...(args.sourceLang ? { sourceLang: args.sourceLang } : {}),
    });
    log(
      `ingest: "${manifest.title}" (${manifest.license ?? "licence unknown"}), ${manifest.transcript.lines.length} lines from ${manifest.transcript.source}, ${manifest.frames.cutTimes.length} cuts, ${manifest.frames.contactSheets.length} contact sheets`,
    );
    analysis = await analyse(dir, {
      env,
      client,
      log,
      stems: args.stems,
      keepMedia: args.keepMedia,
      force: args.force,
    });
  }

  let embedderName: string;
  let embed: (texts: string[]) => Promise<number[][]>;
  let close = () => {};
  if (args.embedder === "labse") {
    if (!LabseEmbedder.available())
      throw new Error(
        "LaBSE is not installed (E:/mellodifai/venvs/labse); install it or pass --embedder openrouter",
      );
    const labse = new LabseEmbedder();
    embedderName = labse.name;
    embed = labse.embed;
    close = () => labse.close();
  } else {
    embedderName = `OpenRouter ${DEFAULT_MODELS.embedding} (fallback, not the design's LaBSE)`;
    embed = (texts) =>
      client.embed(texts, DEFAULT_MODELS.embedding, "originality:embeddings");
  }
  try {
    const lyrics = await rewrite(
      analysis,
      {
        lang: args.lang,
        country: args.country,
        writer: args.writer,
        maxRounds: args.rounds,
        meaningGate: args.meaningGate,
        log,
      },
      { client, embed, embedder: embedderName },
    );
    const lyricsPath = join(dir, `lyrics.${args.lang}.json`);
    await writeFile(lyricsPath, JSON.stringify(lyrics, null, 1));
    await writeFile(
      join(dir, `lyrics.${args.lang}.txt`),
      `${lyrics.title}\n\n${lyrics.lyricsText}\n`,
    );
    // Analysis cost counts once, in the run that made it.
    const analysisUsd = analysis.cost.usd;
    const total = Math.round((analysisUsd + lyrics.cost.usd) * 1e6) / 1e6;
    await writeFile(
      join(dir, `cost.${args.lang}.json`),
      JSON.stringify(
        {
          usd: total,
          analysisUsd,
          lyricsUsd: lyrics.cost.usd,
          thisRunUsd: ledger.usd,
          calls: [...analysis.cost.calls, ...lyrics.cost.calls],
        },
        null,
        1,
      ),
    );
    const last = lyrics.jury.rounds.at(-1);
    const m = analysis.music;
    console.log(
      [
        "",
        `Source: ${analysis.title} (${analysis.url})`,
        `Music: ${m.bpm} BPM, ${m.key.tonic} ${m.key.mode}, ${m.timeSignature.beatsPerBar}/4, vocal ${m.vocal.type} (${m.vocal.delivery}), ${m.durationS.toFixed(0)} s`,
        `Sections: ${m.sections.map((s) => `${s.label} ${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(" | ")}`,
        `Blueprint: ${analysis.blueprint.shots.length} shots, palette ${analysis.blueprint.global.palette.join(" ")}`,
        `Style tags: ${lyrics.styleTags.join(", ")}`,
        `New title: ${lyrics.title} (${lyrics.lang}${lyrics.country ? `, ${lyrics.country}` : ""})`,
        `Jury: ${lyrics.jury.passed ? "PASSED" : "NOT PASSED"} after ${lyrics.jury.rounds.length} round(s), stopped: ${lyrics.jury.stoppedBecause}; scores ${JSON.stringify(last?.scores ?? {})}`,
        `Originality: ${lyrics.originality.flaggedLines} flagged lines, max lexical ${lyrics.originality.maxLexical}, max semantic ${lyrics.originality.maxSemantic}, phrase ${lyrics.originality.phrase.ok ? "ok" : lyrics.originality.phrase.detail}`,
        `Section meaning (${lyrics.originality.meaningGate}; new/source vs map, need 0.55): ${lyrics.originality.sections.map((s) => `${s.sectionId} ${s.meaningCosine ?? "-"}/${s.sourceCosine ?? "-"}`).join(", ")}`,
        `Cost: analysis ${analysisUsd.toFixed(4)} + lyrics ${lyrics.cost.usd.toFixed(4)} = ${total.toFixed(4)} USD${total > COST_TARGET_USD ? ` (over the ${COST_TARGET_USD} USD target)` : ""}`,
        "",
        `analysis:  ${analysisPath}`,
        `blueprint: ${join(dir, "blueprint.json")}`,
        `lyrics:    ${lyricsPath}`,
        `text:      ${join(dir, `lyrics.${args.lang}.txt`)}`,
        `cost:      ${join(dir, `cost.${args.lang}.json`)}`,
      ]
        .join("\n")
        .replaceAll("\\", "/"),
    );
    return lyrics.jury.passed ? 0 : 2;
  } finally {
    close();
  }
}

const invoked = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (/\/(?:cli\.ts|remake\.mjs|remake)$/u.test(invoked)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    async (error: unknown) => {
      const env = await loadEnv().catch(() => null);
      const message = error instanceof Error ? error.message : String(error);
      console.error(env ? env.redact(message) : message);
      process.exitCode = 1;
    },
  );
}
