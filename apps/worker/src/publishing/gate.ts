import type { StageRegistry } from "../loop.js";

// A worker started with WORKER_PUBLISHING=off (the desktop app until its owner configured his
// own engine and YouTube credentials) never touches YouTube: the private upload and the
// privacy change fail at once with this message, and the publishing clock does not run.
export const PUBLISHING_OFF =
  "Pubblicazione spenta su questa installazione: configura il tuo motore e le tue credenziali YouTube, poi riaccendi MellodifAI.";

export function publishingOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WORKER_PUBLISHING !== "off";
}

const PUBLISHING_STAGES = ["publish", "set_privacy"] as const;

export function withPublishingGate(
  registry: StageRegistry,
  on: boolean,
): StageRegistry {
  if (on) return registry;
  const refused = { ...registry };
  for (const stage of PUBLISHING_STAGES)
    refused[stage] = async () => {
      throw new Error(PUBLISHING_OFF);
    };
  return refused;
}
