import { z } from "zod";

// What the PC worker publishes in workers.engines["ace-step"] so the web app can
// show the setup state of the local music engine in plain words.
export const LOCAL_ENGINE_STATES = [
  "not_installed",
  "installing",
  "ready",
  "running",
  "error",
] as const;
export type LocalEngineState = (typeof LOCAL_ENGINE_STATES)[number];

export const LOCAL_ENGINE_STEPS = [
  "download_code",
  "install",
  "download_models",
  "starting",
  "generating",
] as const;
export type LocalEngineStep = (typeof LOCAL_ENGINE_STEPS)[number];

export const LocalEngineStatusSchema = z.object({
  state: z.enum(LOCAL_ENGINE_STATES),
  step: z.enum(LOCAL_ENGINE_STEPS).optional(),
  pct: z.number().min(0).max(100).optional(),
  // Fixed Italian sentence for the end user; never a stack trace or a path.
  message: z.string().max(300).optional(),
  updatedAt: z.string().optional(),
});
export type LocalEngineStatus = z.infer<typeof LocalEngineStatusSchema>;

export function parseLocalEngineStatus(value: unknown): LocalEngineStatus {
  const parsed = LocalEngineStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : { state: "not_installed" };
}

// Plain Italian, no jargon. Shown in the create panel and in job errors.
export const ACE_STEP_TEXT = {
  notInstalled:
    "Il motore musicale gratuito non è ancora sul PC. La prima canzone lo prepara da sola (circa 30-60 minuti, una volta sola).",
  download_code:
    "Sto preparando il motore musicale (primo avvio): scarico il programma.",
  install:
    "Sto preparando il motore musicale (primo avvio, circa 10-20 minuti): installo i componenti.",
  download_models:
    "Sto preparando il motore musicale (primo avvio): scarico la voce e gli strumenti, circa 10 GB.",
  starting: "Sto accendendo il motore musicale, di solito meno di 2 minuti.",
  generating: "Il PC sta componendo la canzone.",
  ready: "Pronto. Gratis, la canzone si crea sul tuo PC in pochi minuti.",
  offline:
    "Il PC è spento o non connesso: il motore gratuito si usa solo a PC acceso.",
  errorNoSpace:
    "Spazio su disco insufficiente per il motore musicale. Libera spazio e riprova.",
  errorNetwork:
    "Non riesco a scaricare il motore musicale. Controlla la connessione e riprova: riprendo da dove mi ero fermato.",
  errorInstall:
    "La preparazione del motore musicale non è riuscita. Riprova: riprendo da dove mi ero fermato.",
  errorStart:
    "Il motore musicale non si è acceso. Riprova tra poco; se succede ancora, riavvia il PC.",
  errorGpu:
    "La scheda video è occupata (forse un gioco o un altro programma). Chiudilo: riprovo da solo tra qualche minuto.",
  errorTake:
    "Il motore musicale non è riuscito a creare la canzone. Riprova: non costa nulla.",
} as const;

export function aceStepStatusText(
  status: LocalEngineStatus,
  online: boolean,
): string {
  if (!online) return ACE_STEP_TEXT.offline;
  if (status.state === "error")
    return status.message ?? ACE_STEP_TEXT.errorInstall;
  if (status.state === "not_installed") return ACE_STEP_TEXT.notInstalled;
  if (status.state === "ready") return ACE_STEP_TEXT.ready;
  const base = status.step
    ? ACE_STEP_TEXT[status.step]
    : ACE_STEP_TEXT.starting;
  return status.pct === undefined ? base : `${base} ${Math.round(status.pct)}%`;
}
