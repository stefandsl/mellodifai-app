import { join } from "node:path";
import type { StageHandler } from "../loop.js";
import { ENGINE_ROOT, key, upload } from "./utils.js";

export const qa: StageHandler = async (context) => {
  const master = await context.db.getRender(context.version.id, "master");
  if (!master?.path) throw new Error("master render is required for QA");
  let analysis = "";
  const probe = context.engine.withWorkspace(
    context.ws.root,
    async (line) => {
      analysis += `${line}\n`;
      await context.log(line);
    },
    context.signal,
  );
  await probe.run(
    "ffmpeg",
    [
      "-i",
      master.path,
      "-filter_complex",
      "ebur128=peak=true",
      "-f",
      "null",
      "-",
    ],
    { cwd: ENGINE_ROOT },
  );
  const loudness = [...analysis.matchAll(/I:\s*(-?[\d.]+)/gu)].at(-1);
  const peak = [...analysis.matchAll(/Peak:\s*(-?[\d.]+)/gu)].at(-1);
  const lufs = Number(loudness?.[1] ?? Number.NaN);
  const dbtp = Number(peak?.[1] ?? Number.NaN);
  const flags = Array.isArray(context.version.qa_flags)
    ? (context.version.qa_flags as {
        kind?: string;
        count?: number;
        value?: number;
      }[])
    : [];
  const crushed = flags.find((flag) => flag.kind === "crushed_words")?.count;
  const timingDuration = flags.find(
    (flag) => flag.kind === "timing_duration",
  )?.value;
  let durationOutput = "";
  const durationProbe = context.engine.withWorkspace(
    context.ws.root,
    async (line) => {
      durationOutput += line;
    },
    context.signal,
  );
  await durationProbe.run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      master.path,
    ],
    { cwd: ENGINE_ROOT },
  );
  const masterDuration = Number(durationOutput.trim());
  if (!Number.isFinite(masterDuration) || masterDuration <= 0)
    throw new Error("Master duration not measured");
  const sheet = join(context.ws.renderDir, "contact-sheet.jpg");
  await context.engine.run(
    "ffmpeg",
    [
      "-y",
      "-i",
      master.path,
      "-vf",
      `fps=20/${masterDuration},scale=320:-1,tile=5x4`,
      "-frames:v",
      "1",
      "-f",
      "image2",
      sheet,
    ],
    { cwd: ENGINE_ROOT, outputs: [sheet] },
  );
  const results = {
    gates: [
      {
        name: "integrated_loudness",
        pass: lufs >= -15 && lufs <= -13,
        value: lufs,
      },
      { name: "true_peak", pass: dbtp <= -1, value: dbtp },
      {
        name: "crushed_words",
        pass: crushed === 0,
        value: crushed ?? "not measured",
      },
      {
        name: "duration",
        pass:
          typeof timingDuration === "number" &&
          Math.abs(masterDuration - timingDuration) <= 0.5,
        value: masterDuration,
        expected: timingDuration ?? "not measured",
      },
    ],
    informational: [
      {
        name: "contact_sheet",
        path: await upload(context, sheet, "image/jpeg"),
      },
    ],
  };
  await context.db.patchRender(master.id, {
    qa_results: {
      ...results,
      ...((master.qa_results as { assets?: unknown } | null)?.assets
        ? { assets: (master.qa_results as { assets: unknown }).assets }
        : {}),
    },
  });
  return {
    enqueue: [{ stage: "art", idempotencyKey: key("art", context) }],
  };
};
