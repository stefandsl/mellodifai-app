import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { actor, call, fixture, hash } from "./helpers/token-fixture";

it("returns the stems job ID for new and existing queued, running and done jobs", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const [p] =
      await tx`insert into public.projects(owner_id,topic) values(${a.user_id},'Stems fixture') returning id`;
    const [v] =
      await tx`insert into public.versions(owner_id,project_id,lang,status) values(${a.user_id},${p.id},'it','audio_ready') returning id`;
    const [t] =
      await tx`insert into public.takes(owner_id,version_id,audio_preview_path) values(${a.user_id},${v.id},'fixture.mp3') returning id`;
    await tx`update public.versions set chosen_take_id=${t.id} where id=${v.id}`;
    const created = await call(tx, "mdf_web", "stems_request", [a, v.id]);
    expect(created).toMatchObject({
      ok: true,
      data: { job_id: expect.any(String), jobs: [{ stage: "stems" }] },
    });
    const id = created.data.job_id;
    expect(created.data.jobs[0].job_id).toBe(id);
    for (const status of ["queued", "running", "done"]) {
      await tx`update public.jobs set status=${status} where id=${id}`;
      const ctx = {
        ...a,
        idempotency_key: randomUUID(),
        request_hash: hash(`stems-${status}`),
      };
      const existing = await call(tx, "mdf_web", "stems_request", [ctx, v.id]);
      expect(existing).toEqual({ ok: true, data: { job_id: id, jobs: [] } });
      expect(await call(tx, "mdf_web", "stems_request", [ctx, v.id])).toEqual(
        existing,
      );
      expect(
        (await tx`select status from public.jobs where id=${id}`)[0].status,
      ).toBe(status);
      expect(
        await tx`select id from public.jobs where version_id=${v.id} and stage='stems'`,
      ).toHaveLength(1);
    }
  });
});
