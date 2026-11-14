import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CapRefused, TsvCapLedger } from "../src/providers/cap-ledger.js";
import { KieClient } from "../src/providers/kie-client.js";
import {
  KIE_PRICES,
  resultUrls,
  runMediaTask,
  SEEDANCE,
  SEEDANCE_UPGRADE,
  SEEDREAM_I2I,
  SEEDREAM_T2I,
  seedanceCredits,
  seedanceDraftBody,
  seedanceSeconds,
  seedanceUpgradeBody,
  seedreamBody,
  seedreamCredits,
} from "../src/providers/kie-media.js";
import { isCapRefusal } from "../src/providers/ledger.js";
import { paidCall } from "../src/providers/paid.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function scratch() {
  const base =
    process.platform === "win32" ? "E:/mellodifai/runtime/tmp" : tmpdir();
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "kie-media-tests-"));
  roots.push(root);
  return root;
}

describe("kie media prices", () => {
  it("bills Seedance by resolution, with the reference video's seconds when there is one", () => {
    // 12 s draft from a 11.7 s black-picture audio video: 17 x (12 + 12).
    expect(
      seedanceCredits({
        resolution: "480p",
        outputSeconds: 12,
        referenceVideoSeconds: 11.7,
      }),
    ).toBe(408);
    expect(seedanceCredits({ resolution: "480p", outputSeconds: 10 })).toBe(
      280,
    );
    expect(
      seedanceCredits({
        resolution: "1080p",
        outputSeconds: 10,
        referenceVideoSeconds: 9.8,
      }),
    ).toBe(1900);
    expect(seedreamCredits(5)).toBe(16.2);
    expect(KIE_PRICES.seedance["1080p"].noVideo).toBe(158);
  });

  it("generates whole seconds from 4 to 30", () => {
    expect(seedanceSeconds(11.7)).toBe(12);
    expect(seedanceSeconds(12)).toBe(12);
    expect(seedanceSeconds(2.5)).toBe(4);
    expect(() => seedanceSeconds(30.5)).toThrow(/30 s/u);
  });
});

describe("kie media requests", () => {
  it("asks for a 480p draft with the references and the audio kept", () => {
    const body = seedanceDraftBody({
      prompt: "p",
      imageUrls: ["https://a/1.png"],
      videoUrls: ["https://a/v.mp4"],
      seconds: 12,
    });
    expect(body.model).toBe(SEEDANCE);
    expect(body.input).toMatchObject({
      draft: true,
      resolution: "480p",
      duration: 12,
      reference_image_urls: ["https://a/1.png"],
      reference_video_urls: ["https://a/v.mp4"],
      omni_reference_task_type: "reference",
      generate_audio: true,
    });
    const bare = seedanceDraftBody({
      prompt: "p",
      imageUrls: [],
      videoUrls: [],
      seconds: 5,
    });
    expect(bare.input).not.toHaveProperty("omni_reference_task_type");
    expect(bare.input).not.toHaveProperty("reference_image_urls");
  });

  it("upgrades a draft by its task id only", () => {
    expect(seedanceUpgradeBody("t1")).toEqual({
      model: SEEDANCE_UPGRADE,
      input: { draft_task_id: "t1", resolution: "1080p", output_format: "mp4" },
    });
    expect(() => seedanceUpgradeBody("")).toThrow();
  });

  it("uses the edit model only with a reference image", () => {
    expect(seedreamBody({ prompt: "p", aspectRatio: "3:4" }).model).toBe(
      SEEDREAM_T2I,
    );
    const edit = seedreamBody({
      prompt: "p",
      imageUrls: ["https://a/b.png"],
      aspectRatio: "3:4",
    });
    expect(edit.model).toBe(SEEDREAM_I2I);
    expect(edit.input.image_urls).toEqual(["https://a/b.png"]);
  });

  it("reads the media URLs, last frame and credits of a finished task", () => {
    expect(
      resultUrls({
        resultJson: JSON.stringify({
          resultUrls: ["https://tempfile.aiquickdraw.com/x.mp4", "ftp://no"],
          lastFrameUrl: "https://tempfile.aiquickdraw.com/x.jpg",
        }),
        creditsConsumed: 340,
      }),
    ).toEqual({
      urls: ["https://tempfile.aiquickdraw.com/x.mp4"],
      lastFrame: "https://tempfile.aiquickdraw.com/x.jpg",
      credits: 340,
    });
    expect(resultUrls({ resultJson: "not json" }).urls).toEqual([]);
  });

  it("submits once, waits, and keeps the task id in a later error", async () => {
    const calls: string[] = [];
    let polls = 0;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      calls.push(`${init?.method ?? "GET"} ${path}`);
      if (path.endsWith("/createTask"))
        return new Response(
          JSON.stringify({ code: 200, data: { taskId: "task-1" } }),
        );
      polls++;
      const data =
        polls < 2
          ? { state: "generating" }
          : {
              state: "success",
              resultJson: JSON.stringify({
                resultUrls: ["https://tempfile.aiquickdraw.com/v.mp4"],
              }),
              creditsConsumed: 408,
            };
      return new Response(JSON.stringify({ code: 200, data }));
    }) as typeof fetch;
    const client = new KieClient("k", fetchImpl, async () => {});
    const seen: string[] = [];
    const task = await runMediaTask(
      client,
      seedanceDraftBody({
        prompt: "p",
        imageUrls: [],
        videoUrls: [],
        seconds: 5,
      }),
      { pollMs: 1, onSubmitted: (id) => void seen.push(id) },
    );
    expect(task).toEqual({
      taskId: "task-1",
      urls: ["https://tempfile.aiquickdraw.com/v.mp4"],
      credits: 408,
    });
    expect(seen).toEqual(["task-1"]);
    expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);

    const failing = new KieClient(
      "k",
      (async (url: string | URL) =>
        new URL(String(url)).pathname.endsWith("/createTask")
          ? new Response(
              JSON.stringify({ code: 200, data: { taskId: "task-2" } }),
            )
          : new Response(
              JSON.stringify({ code: 200, data: { state: "fail" } }),
            )) as typeof fetch,
      async () => {},
    );
    await expect(
      runMediaTask(failing, seedanceUpgradeBody("task-1"), { pollMs: 1 }),
    ).rejects.toThrow(/kie task task-2/u);
  });
});

describe("TSV cap ledger", () => {
  it("reserves before a paid call, settles the real cost and refuses past the cap", async () => {
    const file = join(await scratch(), "ledger.tsv");
    const ledger = new TsvCapLedger(file, 1000, ["prices checked 2026-11-14"]);
    const spent = await paidCall(
      ledger,
      `${SEEDANCE}|12 s draft`,
      { credits: 408 },
      async () => ({ result: "ok", items: { credits: 400 } }),
    );
    expect(spent).toBe("ok");
    expect(await ledger.total()).toBe(400);
    // 400 spent + 408 reserved = 808: still fits; a second 408 would not.
    const open = await ledger.open(`${SEEDANCE}|12 s draft`, { credits: 408 });
    await expect(
      ledger.open(`${SEEDANCE}|12 s draft`, { credits: 408 }),
    ).rejects.toBeInstanceOf(CapRefused);
    await ledger
      .open("x|y", { credits: 500 })
      .catch((error) => expect(isCapRefusal(error)).toBe(true));
    await ledger.settle(open, { credits: 0 });
    expect(await ledger.total()).toBe(400);

    // A reservation left open (a crash) still holds its credits when the file is read again.
    await ledger.open(`${SEEDANCE}|1080p`, { credits: 500 });
    const again = new TsvCapLedger(file, 1000);
    expect(await again.total()).toBe(900);
    await expect(again.open("x|y", { credits: 101 })).rejects.toThrow(
      /cap_exceeded/u,
    );
    const text = await readFile(file, "utf8");
    expect(text.split("\n")[0]).toBe("# prices checked 2026-11-14");
    expect(text).toContain("# cap\t1000");
    expect(text).toMatch(
      /\te001\tbytedance\/seedance-2-5\t12 s draft\t408\t\t408\treserved/u,
    );
    expect(text).toMatch(
      /\te001\tbytedance\/seedance-2-5\t12 s draft\t408\t400\t400\tsettled/u,
    );
  });
});
