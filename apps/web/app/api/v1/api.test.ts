// @vitest-environment node
import { randomUUID } from "node:crypto";
import { CookieCreateSongInput, CreateSongInput } from "@mellodifai/shared";
import { beforeEach, expect, it, vi } from "vitest";
import { TOKEN_OPS } from "@/lib/ops/registry";
import { newPat } from "@/lib/ops/tokens";
import {
  apiCases,
  createInput,
  type Handler,
  jobId,
  pack,
  pathParams,
  remakeAcceptBody,
  remakeId,
  remakeLyricsText,
  remakeUrl,
  requestFor,
  sectionId,
  takeId,
  versionId,
  visualizer,
} from "@/test/api-cases";

const mocks = vi.hoisted(() => ({ callOps: vi.fn(), sql: vi.fn() }));
vi.mock("@/lib/db/ops-client", () => ({
  callOps: mocks.callOps,
  opsSql: () => ({ unsafe: mocks.sql }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const routes = import.meta.glob<Record<string, Handler>>("./**/route.ts");
const params = pathParams;
const remakePack = {
  title: "Mille volti",
  lyrics: remakeLyricsText,
  style: "rock, 79 bpm",
  exclude: "",
  settings: {
    model: "V6",
    styleWeight: 0.7,
    weirdness: 0.35,
    variety: 1,
    duration: null,
  },
  displayMap: {},
  l10n: {},
};
const expectedArgs: Record<string, unknown[]> = {
  songs_list: [null, 20, null, false],
  song_get: [versionId],
  job_status: [jobId, null],
  costs_get: [null, null],
  song_create: [CreateSongInput.parse(createInput)],
  lyrics_approve: [versionId, pack],
  lyrics_back: [versionId],
  song_generate_again: [versionId, 1],
  take_pick: [versionId, takeId],
  video_make: [versionId],
  video_rerender: [versionId],
  video_approve: [versionId],
  stage_retry: [jobId],
  job_cancel: [jobId],
  stems_request: [versionId],
  visualizer_request: [versionId, visualizer],
  remakes_list: [20],
  remake_get: [remakeId],
  remake_start: [remakeUrl, "49rDdMbXd_w", "it", null],
  remake_edit: [remakeId, 3, [{ index: 0, text: "Una riga nuova" }], null],
  remake_regenerate_section: [remakeId, 3, sectionId],
  remake_accept: [
    remakeId,
    3,
    remakePack,
    { model: "V6", engine: "kie", title: "Mille volti" },
    null,
  ],
  remake_retry: [remakeId],
  remake_cancel: [remakeId],
  remake_dismiss: [remakeId],
};
async function handler(row: (typeof apiCases)[number]) {
  const file = `.${row.path.replace(/\{([^}]+)\}/g, "[$1]")}/route.ts`;
  return (await routes[file]())[row.method];
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.callOps.mockImplementation(async (name: string) => ({
    ok: true,
    data:
      name === "idem_begin"
        ? { status: "new" }
        : apiCases.find((row) => row.name === name)?.output,
  }));
});

it("registers exactly the twenty-five 7.3 and 7.3b operations with their HTTP metadata", () => {
  expect(TOKEN_OPS).toHaveLength(25);
  expect(TOKEN_OPS.map((def) => ({ name: def.name, ...def.http }))).toEqual(
    apiCases.map(({ name, method, path }) => ({
      name,
      method,
      path: `/api/v1${path}`,
    })),
  );
  expect(
    TOKEN_OPS.every(
      (def) =>
        def.mutating === def.key && def.key === (def.http.method === "POST"),
    ),
  ).toBe(true);
});
it.each(apiCases)(
  "$method $path returns the $name output envelope",
  async (row) => {
    const response = await (await handler(row))(
      requestFor(row, newPat().token),
      { params: Promise.resolve(params) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: row.output });
    expect(mocks.callOps).toHaveBeenLastCalledWith(row.name, expect.any(Array));
    expect(mocks.callOps.mock.calls.at(-1)?.[1].slice(1)).toEqual(
      expectedArgs[row.name],
    );
    const ctx = mocks.callOps.mock.calls.at(-1)?.[1][0];
    expect(ctx).toMatchObject({ actor_kind: "pat", remote: false });
    if (row.method === "POST") expect(ctx.idempotency_key).toBeTruthy();
  },
);
it.each(apiCases)("$name refuses OAuth and cookies", async (row) => {
  const route = await handler(row);
  for (const auth of ["oauth-access-token", ""]) {
    const req = requestFor(row, auth);
    if (!auth) req.headers.delete("authorization");
    req.headers.set("cookie", "sb-access-token=session");
    const response = await route(req, { params: Promise.resolve(params) });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "unauthorized" },
    });
  }
  expect(mocks.callOps).not.toHaveBeenCalled();
  expect(mocks.sql).not.toHaveBeenCalled();
});
it.each(apiCases.filter((row) => row.method === "POST"))(
  "$name requires an idempotency header",
  async (row) => {
    const req = requestFor(row, newPat().token);
    req.headers.delete("Idempotency-Key");
    expect(
      (await (await handler(row))(req, { params: Promise.resolve(params) }))
        .status,
    ).toBe(422);
    expect(mocks.callOps).not.toHaveBeenCalled();
  },
);
it("refuses upload sources on token song creation", async () => {
  const row = apiCases[4];
  const body = {
    ...createInput,
    settings: {
      engine: "kie",
      source: {
        mode: "cover",
        upload: `${randomUUID()}/audio/${randomUUID()}.mp3`,
      },
    },
  };
  expect(CookieCreateSongInput.safeParse(body).success).toBe(true);
  const req = new Request(requestFor(row, newPat().token), {
    body: JSON.stringify(body),
  });
  expect(
    (await (await handler(row))(req, { params: Promise.resolve({}) })).status,
  ).toBe(422);
  expect(mocks.callOps).not.toHaveBeenCalled();
});
it("parses pagination and filters without treating false as true", async () => {
  const route = await handler(apiCases[0]);
  for (const query of [
    "",
    "?cursor=&limit=100&include_trashed=false",
    "?cursor=YWJj&limit=1&status=failed&include_trashed=true",
  ]) {
    const response = await route(
      new Request(`http://localhost/api/v1/songs${query}`, {
        headers: { authorization: `Bearer ${newPat().token}` },
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(200);
  }
  expect(mocks.callOps.mock.calls.map((call) => call[1].slice(1))).toEqual([
    [null, 20, null, false],
    [null, 100, null, false],
    ["YWJj", 1, "failed", true],
  ]);
});
it.each(["limit=101", "limit=0", "limit=no", "include_trashed=no"])(
  "rejects invalid query %s",
  async (query) => {
    const req = new Request(`http://localhost/api/v1/songs?${query}`, {
      headers: { authorization: `Bearer ${newPat().token}` },
    });
    expect(
      (await (await handler(apiCases[0]))(req, { params: Promise.resolve({}) }))
        .status,
    ).toBe(422);
    expect(mocks.callOps).not.toHaveBeenCalled();
  },
);
it("forwards job event cursors and cost dates", async () => {
  for (const [index, query, expected] of [
    [2, "?events_after=42", [jobId, 42]],
    [3, "?from=2026-11-01&to=2026-11-06", ["2026-11-01", "2026-11-06"]],
  ] as const) {
    const req = requestFor(apiCases[index], newPat().token);
    await (await handler(apiCases[index]))(new Request(req.url + query, req), {
      params: Promise.resolve(params),
    });
    expect(mocks.callOps.mock.calls.at(-1)?.[1].slice(1)).toEqual(expected);
  }
});
it("uses path IDs over body IDs and maps lyric_pack to the existing operation", async () => {
  const row = apiCases[5];
  const req = new Request(requestFor(row, newPat().token), {
    body: JSON.stringify({ lyric_pack: pack, version_id: randomUUID() }),
  });
  expect(
    (await (await handler(row))(req, { params: Promise.resolve(params) }))
      .status,
  ).toBe(200);
  expect(mocks.callOps.mock.calls.at(-1)?.[1].slice(1)).toEqual([
    versionId,
    pack,
  ]);
});
it.each(["{", "null", "[]", '"text"'])(
  "maps malformed/non-object JSON %s to validation",
  async (body) => {
    const row = apiCases[4];
    const req = new Request(requestFor(row, newPat().token), { body });
    expect(
      (await (await handler(row))(req, { params: Promise.resolve({}) })).status,
    ).toBe(422);
    expect(mocks.callOps).not.toHaveBeenCalled();
  },
);
it("maps ambiguous_spend to 409 without retrying", async () => {
  mocks.callOps
    .mockResolvedValueOnce({ ok: true, data: { status: "new" } })
    .mockResolvedValueOnce({
      ok: false,
      code: "ambiguous_spend",
      message: "Resolve unknown submission first",
    });
  const row = apiCases[7];
  const response = await (await handler(row))(requestFor(row, newPat().token), {
    params: Promise.resolve(params),
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: {
      code: "ambiguous_spend",
      message: "Resolve unknown submission first",
    },
  });
  expect(mocks.callOps).toHaveBeenCalledTimes(2);
});

it("every token operation says what it does, its scope and what to call next", () => {
  for (const def of TOKEN_OPS) {
    expect(def.description.length, def.name).toBeGreaterThanOrEqual(20);
    expect(def.description.length, def.name).toBeLessThanOrEqual(300);
    expect(def.description, def.name).toMatch(/^[A-Z][^\n]*\.$/u);
    expect(def.description, def.name).toMatch(/\(scope (read|create|spend)/u);
    expect(def.description).not.toContain(String.fromCodePoint(0x2014));
  }
  // The scope a tool names is the one the database asks of a token.
  const scopes = Object.fromEntries(
    TOKEN_OPS.filter((def) => def.name.startsWith("remake")).map((def) => [
      def.name,
      def.scope,
    ]),
  );
  expect(scopes).toEqual({
    remakes_list: "read",
    remake_get: "read",
    remake_start: "spend",
    remake_edit: "spend",
    remake_regenerate_section: "spend",
    remake_accept: "spend",
    remake_retry: "spend",
    remake_cancel: "create",
    remake_dismiss: "create",
  });
  for (const def of TOKEN_OPS.filter((d) => d.name.startsWith("remake")))
    expect(def.description, def.name).toContain(`(scope ${def.scope}`);
});

const remakeRow = (name: string) => {
  const row = apiCases.find((item) => item.name === name);
  if (!row) throw new Error(`No API case for ${name}`);
  return row;
};
async function post(name: string, body: unknown) {
  const row = remakeRow(name);
  const response = await (await handler(row))(
    new Request(requestFor(row, newPat().token), {
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) },
  );
  return {
    status: response.status,
    args: mocks.callOps.mock.calls.at(-1)?.[1].slice(1) as
      | unknown[]
      | undefined,
  };
}

it.each([
  ["49rDdMbXd_w", "https://www.youtube.com/watch?v=49rDdMbXd_w"],
  ["  youtu.be/49rDdMbXd_w ", "https://youtu.be/49rDdMbXd_w"],
  [
    "www.youtube.com/watch?v=49rDdMbXd_w&t=5",
    "https://www.youtube.com/watch?v=49rDdMbXd_w&t=5",
  ],
  [
    "http://music.youtube.com/watch?v=49rDdMbXd_w",
    "http://music.youtube.com/watch?v=49rDdMbXd_w",
  ],
])("remake_start maps the link %s like the create panel", async (url, sent) => {
  const result = await post("remake_start", {
    url,
    lang: "ja",
    country: "JP",
  });
  expect(result.status).toBe(200);
  expect(result.args).toEqual([sent, "49rDdMbXd_w", "ja", "JP"]);
});
it.each([
  { url: "https://example.com/watch?v=49rDdMbXd_w", lang: "it" },
  { url: "not a link", lang: "it" },
  { url: "", lang: "it" },
  { url: `https://youtu.be/49rDdMbXd_w?${"x".repeat(500)}`, lang: "it" },
  { url: remakeUrl, lang: "xx" },
  { url: remakeUrl, lang: "it", country: "it" },
  { url: remakeUrl },
])("remake_start refuses %j before any database call", async (body) => {
  expect((await post("remake_start", body)).status).toBe(422);
  expect(mocks.callOps).not.toHaveBeenCalled();
});

it("remake_edit trims lines and the title like the cookie review", async () => {
  const result = await post("remake_edit", {
    revision: 0,
    lines: [
      { index: 4, text: "  Una riga nuova  " },
      { index: 7, text: "x".repeat(200) },
    ],
    title: "  Nuovo titolo ",
  });
  expect(result.status).toBe(200);
  expect(result.args).toEqual([
    remakeId,
    0,
    [
      { index: 4, text: "Una riga nuova" },
      { index: 7, text: "x".repeat(200) },
    ],
    "Nuovo titolo",
  ]);
  expect((await post("remake_edit", { revision: 2, lines: [] })).args).toEqual([
    remakeId,
    2,
    [],
    null,
  ]);
});
it.each([
  { revision: 0, lines: [{ index: 0, text: "due\nrighe" }] },
  { revision: 0, lines: [{ index: 0, text: "   " }] },
  { revision: 0, lines: [{ index: 0, text: "x".repeat(201) }] },
  {
    revision: 0,
    lines: [{ index: 0, text: `una ${String.fromCodePoint(0x2014)} riga` }],
  },
  { revision: 0, lines: [{ index: -1, text: "riga" }] },
  { revision: 0, lines: [{ index: 0.5, text: "riga" }] },
  {
    revision: 0,
    lines: Array.from({ length: 201 }, (_, index) => ({ index, text: "riga" })),
  },
  { revision: 0, lines: [], title: "x".repeat(101) },
  { revision: 0, lines: [], title: " " },
  { revision: -1, lines: [] },
  { lines: [] },
  { revision: 0 },
])("remake_edit refuses invalid edits (%#)", async (body) => {
  expect((await post("remake_edit", body)).status).toBe(422);
  expect(mocks.callOps).not.toHaveBeenCalled();
});

it("remake_accept composes the pack from the echoed text and drops a source", async () => {
  const result = await post("remake_accept", {
    ...remakeAcceptBody,
    title: "  Mille volti ",
    vocal_gender: "f",
    settings: {
      engine: "kie",
      model: "V5",
      bpm: 79,
      exclude: "rap",
      duration: 120,
      source: {
        mode: "cover",
        takeId: "22222222-2222-4222-8222-222222222222",
        title: "t",
      },
    },
  });
  expect(result.status).toBe(200);
  expect(result.args).toEqual([
    remakeId,
    3,
    {
      ...remakePack,
      exclude: "rap",
      settings: {
        ...remakePack.settings,
        model: "V5",
        vocalGender: "f",
        duration: 120,
      },
    },
    {
      engine: "kie",
      model: "V5",
      bpm: 79,
      exclude: "rap",
      duration: 120,
      title: "Mille volti",
    },
    "f",
  ]);
  // The text is passed on untouched, also its spaces and blank lines.
  const text = "[Intro]\n\n[Verse 1]\n Una riga \n";
  const untouched = await post("remake_accept", {
    ...remakeAcceptBody,
    lyrics_text: text,
  });
  expect(untouched.args?.[2]).toMatchObject({ lyrics: text });
});
it.each([
  { ...remakeAcceptBody, lyrics_text: "" },
  { ...remakeAcceptBody, lyrics_text: undefined },
  { ...remakeAcceptBody, title: "x".repeat(81) },
  { ...remakeAcceptBody, style: "" },
  { ...remakeAcceptBody, revision: undefined },
  { ...remakeAcceptBody, vocal_gender: "x" },
  { ...remakeAcceptBody, settings: { engine: "suno" } },
])("remake_accept refuses an invalid input (%#)", async (body) => {
  expect((await post("remake_accept", body)).status).toBe(422);
  expect(mocks.callOps).not.toHaveBeenCalled();
});

it("the remake named by the path wins over the body and a malformed id is refused", async () => {
  expect(
    (await post("remake_cancel", { remake_id: randomUUID() })).args,
  ).toEqual([remakeId]);
  const row = remakeRow("remake_get");
  const response = await (await handler(row))(
    requestFor(row, newPat().token, { remake_id: "not-an-id" }),
    { params: Promise.resolve({ remake_id: "not-an-id" }) },
  );
  expect(response.status).toBe(422);
  const section = remakeRow("remake_regenerate_section");
  expect(
    (
      await (
        await handler(section)
      )(
        new Request(requestFor(section, newPat().token), {
          body: JSON.stringify({ revision: 3 }),
        }),
        {
          params: Promise.resolve({ ...params, section_id: "x".repeat(41) }),
        },
      )
    ).status,
  ).toBe(422);
});

it("remakes_list takes its limit from the query", async () => {
  const row = remakeRow("remakes_list");
  const call = async (query: string) =>
    (await handler(row))(
      new Request(`http://localhost/api/v1/remakes${query}`, {
        headers: { authorization: `Bearer ${newPat().token}` },
      }),
      { params: Promise.resolve({}) },
    );
  expect((await call("?limit=5")).status).toBe(200);
  expect(mocks.callOps.mock.calls.at(-1)?.[1].slice(1)).toEqual([5]);
  for (const query of ["?limit=0", "?limit=101", "?limit=no"])
    expect((await call(query)).status).toBe(422);
  expect(mocks.callOps).toHaveBeenCalledTimes(1);
});

it("a lost answer is ambiguous_spend for the paid remake steps only", async () => {
  for (const [name, status, code] of [
    ["remake_start", 409, "ambiguous_spend"],
    ["remake_edit", 409, "ambiguous_spend"],
    ["remake_regenerate_section", 409, "ambiguous_spend"],
    ["remake_accept", 409, "ambiguous_spend"],
    ["remake_retry", 409, "ambiguous_spend"],
    ["remake_cancel", 500, "internal"],
    ["remake_dismiss", 500, "internal"],
  ] as const) {
    mocks.callOps.mockReset();
    mocks.callOps
      .mockResolvedValueOnce({ ok: true, data: { status: "new" } })
      .mockResolvedValueOnce({
        ok: false,
        code: "internal",
        message: "Internal error",
        details: { reason: "completion_unknown" },
      });
    const row = remakeRow(name);
    const response = await (await handler(row))(
      requestFor(row, newPat().token),
      { params: Promise.resolve(params) },
    );
    expect(response.status, name).toBe(status);
    expect((await response.json()).error.code, name).toBe(code);
    expect(mocks.callOps).toHaveBeenCalledTimes(2);
  }
});
