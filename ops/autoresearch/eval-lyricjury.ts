// FROZEN evaluator of the lyric jury prompt (autoresearch runs nov19-lyricjury and nov20-lyricjury2).
// Do not edit during the loop.
//   pnpm -s ops autoresearch/eval-lyricjury.ts > run.log 2>&1 ; grep "^score:" run.log
//   pnpm -s ops autoresearch/eval-lyricjury.ts --set v2 > run.log 2>&1   (harder near-miss set)
// v2 samples also carry the user's brief and the reference lyrics; they go to the jury in the
// context, which the jury may use or ignore. v1 runs exactly as before.
// Runs the production `judge` (apps/worker/src/stages/lyric-jury.ts) with one local Ollama model as
// the only judge on every sample of the frozen golden set, and compares `passed` with the expected
// verdict. Zero paid calls: the OpenRouter transport is replaced by a fetch to local Ollama.
// A jury that answers nothing passes the draft (production behaviour), so it counts as a pass.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { judge } from "../../apps/worker/src/stages/lyric-jury.js";

const setArg = process.argv.indexOf("--set");
const SET = setArg >= 0 ? process.argv[setArg + 1] : "v1";
if (SET !== "v1" && SET !== "v2") throw new Error(`unknown set ${SET}`);
const GOLDEN = join(
  import.meta.dirname,
  SET === "v2" ? "golden-lyrics-v2" : "golden-lyrics",
);
const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.JURY_MODEL ?? "gemma4:e4b";
const SEED = 42;
const NUM_CTX = 8192;

type Sample = {
  id: string;
  expected: "pass" | "fail";
  lang: string;
  topic: string;
  referenceTitle: string;
  category?: string;
  brief?: string;
  referenceLyrics?: string;
  title: string;
  style: string;
  lyrics: string;
};

// Translates the OpenRouter chat request into a deterministic Ollama /api/chat request and the
// reply back into the OpenRouter shape. Only "chat" is supported: the local model is not Jev.
const fetchFn: typeof fetch = async (url, init) => {
  if (!String(url).endsWith("/chat/completions"))
    throw new Error(`unsupported endpoint ${String(url)}`);
  const body = JSON.parse(String(init?.body)) as {
    messages: { role: string; content: string }[];
    response_format?: { type?: string };
  };
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: body.messages,
      stream: false,
      think: false,
      ...(body.response_format?.type === "json_object"
        ? { format: "json" }
        : {}),
      options: { temperature: 0, seed: SEED, num_ctx: NUM_CTX },
    }),
  });
  if (!response.ok)
    return new Response(await response.text(), { status: response.status });
  const json = (await response.json()) as { message?: { content?: string } };
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: json.message?.content ?? "" } }],
    }),
    { headers: { "Content-Type": "application/json" } },
  );
};

const files = readdirSync(GOLDEN)
  .filter((f) => f.endsWith(".json"))
  .sort();
const hash = createHash("sha256");
const samples = files.map((f) => {
  const text = readFileSync(join(GOLDEN, f), "utf8");
  hash.update(f).update(text);
  return JSON.parse(text) as Sample;
});
console.log(
  `golden${SET === "v2" ? "-v2" : ""}: ${samples.length} samples sha256=${hash.digest("hex").slice(0, 16)} model=${MODEL}`,
);

const only = process.env.ONLY;
let truePass = 0;
let trueFail = 0;
let falsePass = 0;
let falseFail = 0;
let unavailable = 0;
const ms: number[] = [];
const categories = new Map<string, { ok: number; n: number }>();
for (const s of samples) {
  if (only && !s.id.includes(only)) continue;
  const context = {
    topic: s.topic,
    lang: s.lang,
    referenceTitle: s.referenceTitle,
    ...(SET === "v2"
      ? { brief: s.brief ?? "", referenceLyrics: s.referenceLyrics ?? "" }
      : {}),
  };
  const report = await judge(
    { title: s.title, lyrics: s.lyrics, style: s.style },
    context,
    [MODEL],
    { key: "local", fetchFn },
  );
  ms.push(report.ms);
  if (!report.available) unavailable += 1;
  const got = report.passed ? "pass" : "fail";
  if (s.expected === "pass") got === "pass" ? truePass++ : falseFail++;
  else got === "fail" ? trueFail++ : falsePass++;
  const verdict = report.verdicts[0];
  if (s.category) {
    const c = categories.get(s.category) ?? { ok: 0, n: 0 };
    c.n += 1;
    if (got === s.expected) c.ok += 1;
    categories.set(s.category, c);
  }
  console.log(
    `${got === s.expected ? "ok  " : "MISS"} ${s.id} expected=${s.expected} got=${got} ms=${report.ms} scores=${JSON.stringify(report.scores)}${verdict?.error ? ` error=${verdict.error}` : ""}`,
  );
}

const passRecall = truePass / Math.max(1, truePass + falseFail);
const failRecall = trueFail / Math.max(1, trueFail + falsePass);
ms.sort((a, b) => a - b);
const median = ms.length ? ms[Math.floor((ms.length - 1) / 2)] : 0;
for (const [name, c] of [...categories].sort())
  console.log(`category ${name}: ${c.ok}/${c.n}`);
console.log(`pass_recall: ${(passRecall * 100).toFixed(1)}`);
console.log(`fail_recall: ${(failRecall * 100).toFixed(1)}`);
console.log(`false_pass: ${falsePass}`);
console.log(`false_fail: ${falseFail}`);
console.log(`unavailable: ${unavailable}`);
console.log(`median_ms: ${median}`);
console.log(`score: ${(((passRecall + failRecall) / 2) * 100).toFixed(1)}`);
