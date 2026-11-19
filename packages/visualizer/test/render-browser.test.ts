import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const script = fileURLToPath(new URL("../scripts/render.mjs", import.meta.url));

it("refuses to render, without downloading or borrowing a browser, when its chosen Chrome is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "mdf-render-"));
  try {
    const run = spawnSync(
      process.execPath,
      [script, join(dir, "props.json"), join(dir, "out.mp4"), dir],
      {
        env: {
          ...process.env,
          RENDER_TMP: join(dir, "tmp"),
          REMOTION_BROWSER: join(dir, "missing", "chrome-headless-shell.exe"),
        },
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("chrome-headless-shell.exe");
    expect(run.stderr).toMatch(/video/iu);
    // Remotion never started: it would have printed its own banner or bundling lines.
    expect(`${run.stdout}${run.stderr}`).not.toMatch(/bundl|remotion/iu);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
