// Remake engine (task 24): R1 ingest, R2 analyse, R3 rewrite lyrics. The data contracts
// live in @mellodifai/shared (src/remake), so the worker, the web app and MCP share them.
export {
  analyseLines,
  buildSections,
  parseVtt,
  wordsToLines,
} from "./align.js";
export { type AnalyseOptions, analyse } from "./analyse.js";
export { LabseEmbedder } from "./embed.js";
export { type Env, loadEnv } from "./env.js";
export { type IngestOptions, ingest, parseVideoId } from "./ingest.js";
export {
  type Client,
  createClient,
  DEFAULT_MODELS,
  Ledger,
  RedactionError,
} from "./openrouter.js";
export {
  checkPhrases,
  checkSections,
  DEFAULT_THRESHOLDS,
  scoreLines,
} from "./originality.js";
export { remakesRoot, runtimeRoot } from "./paths.js";
export { type RewriteOptions, rewrite } from "./rewrite.js";
export { buildShots, classifyVocal } from "./shots.js";
export { deriveStyleTags, sanitizeTags } from "./style.js";
export { countSyllables, fitLine, lineEnding } from "./syllables.js";
