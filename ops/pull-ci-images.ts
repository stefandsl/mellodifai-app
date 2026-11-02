import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stackDir } from "./lib/envs.js";
import { type Runner, realRunner } from "./lib/run.js";

// Digests verified against the installed pins and the upstream registries.
// A pin change requires re-verification, not a floating-tag fallback.
const mirrors: Record<string, string> = JSON.parse(
  readFileSync(
    new URL("./compose/ci-image-mirrors.json", import.meta.url),
    "utf8",
  ),
);

export async function pullCiImages(
  images: string[],
  runner: Runner = realRunner,
): Promise<void> {
  const unique = [...new Set(images)];
  for (const image of unique) {
    if (!mirrors[image] || !/@sha256:[a-f0-9]{64}$/.test(mirrors[image]))
      throw new Error(`Unverified CI image pin: ${image}`);
  }
  for (const image of unique) {
    const mirror = mirrors[image] as string;
    const pulled = await runner("docker", ["pull", mirror]);
    if (pulled.code !== 0) throw new Error(`Image pull failed: ${image}`);
    const tagged = await runner("docker", ["tag", mirror, image]);
    if (tagged.code !== 0) throw new Error(`Image tag failed: ${image}`);
  }
}

async function main() {
  if (process.env.CI !== "true")
    throw new Error("Image provisioning requires isolated CI");
  const compose = JSON.parse(
    readFileSync(join(stackDir("ci"), "compose.json"), "utf8"),
  ) as {
    services: Record<string, { image: string }>;
  };
  await pullCiImages(
    Object.values(compose.services).map((service) => service.image),
  );
  console.log("Verified pinned CI images are available locally");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "CI image provisioning failed",
    );
    process.exitCode = 1;
  });
