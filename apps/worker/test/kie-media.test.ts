import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CapRefused,
  TsvCapLedger,
  validCap,
} from "../src/providers/cap-ledger.js";
import { KieClient, KieRefused } from "../src/providers/kie-client.js";
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
import { generatePaid, RunStopped } from "../src/providers/paid-generate.js";

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
    await ledger.lock();
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
    await expect(ledger.open("x|y", { credits: 500 })).rejects.toSatisfy(
      isCapRefusal,
    );
    await ledger.settle(open, { credits: 0 });
    expect(await ledger.total()).toBe(400);

    // A reservation left open (a crash) still holds its credits when the file is read again.
    await ledger.open(`${SEEDANCE}|1080p`, { credits: 500 });
    await ledger.unlock();
    const again = new TsvCapLedger(file, 1000);
    expect(await again.total()).toBe(900);
    await again.lock();
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
    await again.unlock();
  });

  it("holds one paid run at a time and reads the rows again under the lock", async () => {
    const root = await scratch();
    const file = join(root, "ledger.tsv");
    const first = new TsvCapLedger(file, 1000);
    const second = new TsvCapLedger(file, 1000);
    // Loaded before the first run wrote anything.
    expect(await second.total()).toBe(0);
    await expect(first.open("m|u", { credits: 1 })).rejects.toThrow(/lock/u);
    await first.lock();
    await expect(second.lock()).rejects.toThrow(/locked by process/u);
    const entry = await first.open("m|u", { credits: 600 });
    await first.settle(entry, { credits: 600 });
    await first.unlock();
    await second.lock();
    // 600 spent by the first run: 500 more would pass the cap of 1000.
    await expect(second.open("m|u", { credits: 500 })).rejects.toThrow(
      /cap_exceeded/u,
    );
    await second.unlock();

    // A lock left by a process that is gone is taken over.
    await writeFile(`${file}.lock`, "999999");
    await first.lock();
    await first.unlock();

    // Concurrent first reads all see every row.
    const fresh = new TsvCapLedger(file, 1000);
    expect(await Promise.all([fresh.total(), fresh.total()])).toEqual([
      600, 600,
    ]);
    // A damaged file stays refused on every later read.
    await writeFile(
      file,
      `${await readFile(file, "utf8")}t\te009\tm\tu\tx\t\t0\tr\n`,
    );
    const damaged = new TsvCapLedger(file, 1000);
    await expect(damaged.total()).rejects.toThrow(/damaged/u);
    await expect(damaged.total()).rejects.toThrow(/damaged/u);
  });

  it("refuses a damaged ledger instead of counting a bad row as nothing", async () => {
    const root = await scratch();
    const head =
      "# cap\t1000\ntime\tentry\tmodel\tunits\testimated\tactual\trunning_total\tnote\n";
    for (const [name, row] of [
      ["estimate", "t\te001\tm\tu\tabc\t\t0\treserved"],
      ["empty estimate", "t\te001\tm\tu\t\t\t0\treserved"],
      ["actual", "t\te001\tm\tu\t408\tNaN\t0\tsettled"],
      ["infinite actual", "t\te001\tm\tu\t408\tInfinity\t0\tsettled"],
    ] as const) {
      const file = join(root, `${name.replace(/ /gu, "-")}.tsv`);
      await writeFile(file, `${head}${row}\n`);
      await expect(new TsvCapLedger(file, 1000).total()).rejects.toThrow(
        /damaged/u,
      );
    }
  });

  it("refuses a cap that is not a number in (0, 5000] or differs from the ledger's", async () => {
    for (const bad of ["abc", "", "NaN", "Infinity", "0", "-5", "5001"])
      expect(() => validCap(bad), bad).toThrow(/cap_invalid/u);
    expect(validCap("5000")).toBe(5000);
    expect(validCap("12.5")).toBe(12.5);
    for (const bad of [Number.NaN, 0, -1, 5000.01, Number.POSITIVE_INFINITY])
      expect(() => new TsvCapLedger("unused.tsv", bad)).toThrow(/cap_invalid/u);

    const root = await scratch();
    const file = join(root, "ledger.tsv");
    expect(await new TsvCapLedger(file, 1000).total()).toBe(0);
    await expect(new TsvCapLedger(file, 2000).total()).rejects.toThrow(
      /cap_mismatch/u,
    );
    const headless = join(root, "headless.tsv");
    await writeFile(
      headless,
      "time\tentry\tmodel\tunits\testimated\tactual\trunning_total\tnote\n",
    );
    await expect(new TsvCapLedger(headless, 1000).total()).rejects.toThrow(
      /cap_mismatch/u,
    );
  });
});

describe("paid generation", () => {
  const ok = (data: unknown) =>
    new Response(JSON.stringify({ code: 200, data }));
  const success = (credits?: number) =>
    ok({
      state: "success",
      resultJson: JSON.stringify({
        resultUrls: ["https://tempfile.aiquickdraw.com/v.mp4"],
      }),
      ...(credits === undefined ? {} : { creditsConsumed: credits }),
    });
  const refused = () =>
    new Response(JSON.stringify({ code: 422, msg: "bad input" }), {
      status: 422,
    });

  // A kie stand-in: createTask and recordInfo answer per submission number n. The balance never
  // moves (the production worker spends from the same account, so it says nothing).
  function fakeKie(
    create: (n: number) => Response,
    record: (n: number) => Response,
  ) {
    const calls = { create: 0 };
    const fetchImpl = (async (url: string | URL) => {
      const target = new URL(String(url));
      if (target.pathname.endsWith("/chat/credit")) return ok(10_000);
      if (target.pathname.endsWith("/createTask"))
        return create(++calls.create);
      if (target.pathname.endsWith("/recordInfo")) return record(calls.create);
      if (target.hostname === "tempfile.aiquickdraw.com")
        return new Response("mp4");
      throw new Error(`unexpected call ${target.href}`);
    }) as typeof fetch;
    return { client: new KieClient("k", fetchImpl, async () => {}), calls };
  }

  async function run(
    kie: ReturnType<typeof fakeKie>,
    taskOptions: { timeoutMs?: number } = {},
  ) {
    const root = await scratch();
    const file = join(root, "ledger.tsv");
    const ledger = new TsvCapLedger(file, 1000);
    await ledger.lock();
    const job = {
      label: "draft 5",
      model: SEEDANCE,
      units: "12 s draft",
      estimate: 408,
      body: seedanceDraftBody({
        prompt: "p",
        imageUrls: [],
        videoUrls: [],
        seconds: 12,
      }),
      file: join(root, "draft.mp4"),
    };
    const result = generatePaid(ledger, kie.client, job, {
      pollMs: 1,
      ...taskOptions,
    }).finally(() => ledger.unlock());
    // Read again from the file, as a later run would.
    const held = async () => new TsvCapLedger(file, 1000).total();
    return { file, job, result, held };
  }

  it("retries once a task that failed on kie's side", async () => {
    const kie = fakeKie(
      (n) => ok({ taskId: `t${n}` }),
      (n) => (n === 1 ? ok({ state: "fail" }) : success(400)),
    );
    const { job, result, held } = await run(kie);
    await expect(result).resolves.toMatchObject({ taskId: "t2", credits: 400 });
    expect(kie.calls.create).toBe(2);
    expect(await held()).toBe(400);
    expect(await readFile(job.file, "utf8")).toBe("mp4");
  });

  it("retries once a refused submission, and stops after a second refusal", async () => {
    const once = fakeKie(
      (n) => (n === 1 ? refused() : ok({ taskId: "t2" })),
      () => success(400),
    );
    await expect((await run(once)).result).resolves.toMatchObject({
      taskId: "t2",
    });
    expect(once.calls.create).toBe(2);

    const twice = fakeKie(refused, () => success(400));
    const second = await run(twice);
    await expect(second.result).rejects.toBeInstanceOf(KieRefused);
    expect(twice.calls.create).toBe(2);
    expect(await second.held()).toBe(0);
  });

  it("never submits again a task still pending: the reservation stays held and the run stops", async () => {
    const kie = fakeKie(
      () => ok({ taskId: "t1" }),
      () => ok({ state: "generating" }),
    );
    const { result, held } = await run(kie, { timeoutMs: 0 });
    await expect(result).rejects.toBeInstanceOf(RunStopped);
    expect(kie.calls.create).toBe(1);
    expect(await held()).toBe(408);
  });

  it("never submits again after a submission with no answer", async () => {
    const kie = fakeKie(
      () => new Response(JSON.stringify({ code: 500 }), { status: 500 }),
      () => success(400),
    );
    const { file, result, held } = await run(kie);
    await expect(result).rejects.toThrow(/outcome unknown/u);
    expect(kie.calls.create).toBe(1);
    expect(await held()).toBe(408);
    expect(await readFile(file, "utf8")).toMatch(
      /\te001\t[^\n]*\t408\t\t408\tambiguous/u,
    );
  });
});
