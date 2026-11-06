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
  requestFor,
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
const params = { version_id: versionId, job_id: jobId, take_id: takeId };
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

it("registers exactly the sixteen 7.3 operations with their HTTP metadata", () => {
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
