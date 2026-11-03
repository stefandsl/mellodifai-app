import { expect, it } from "vitest";
import { actor, call, fixture } from "./helpers/token-fixture";

it("queues master lyric alignment through mdf_web while direct public execution stays revoked", async () => {
  await fixture(async (tx) => {
    const a = await actor(tx);
    const [p] =
      await tx`insert into public.projects(owner_id,topic) values(${a.user_id},'Alignment fixture') returning id`;
    const [v] =
      await tx`insert into public.versions(owner_id,project_id,lang,status,lyric_pack)
      values(${a.user_id},${p.id},'it','approved','{"lyrics":"Ciao mondo"}') returning id`;
    await tx`insert into public.renders(owner_id,version_id,kind,render_attempt,preview_path)
      values(${a.user_id},${v.id},'master',1,'preview.mp4')`;
    const result = await call(tx, "mdf_web", "lyric_alignment_request", [
      a,
      v.id,
      null,
    ]);
    expect(result).toMatchObject({
      ok: true,
      data: { job_id: expect.any(String), jobs: [{ stage: "align_lyrics" }] },
    });
    const [job] =
      await tx`select stage, status from public.jobs where id=${result.data.job_id}`;
    expect(job).toMatchObject({ stage: "align_lyrics", status: "queued" });
    const [grant] =
      await tx`select has_function_privilege('authenticated','public.request_lyric_alignment(uuid,uuid)','EXECUTE') as allowed`;
    expect(grant.allowed).toBe(false);
  });
});
