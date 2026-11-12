import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { actor, call, fixture, hash } from "./helpers/token-fixture";

it.each([16, 18])(
  "counts every reservation in a batch with %i already in the hour",
  async (used) => {
    await fixture(async (tx) => {
      await tx`set local mdf.force_caps='on'`;
      const session = await actor(tx);
      const tokenHash = hash(randomUUID());
      const token = await call(tx, "mdf_web", "admin_token_create", [
        session,
        "Reservation rate test",
        tokenHash,
        "test",
        ["spend"],
        false,
        false,
        null,
      ]);
      expect(token.ok).toBe(true);
      const [identity] =
        await tx`select id from public.agent_tokens where token_hash=${tokenHash}`;
      await tx`update public.spend_caps set "limit"=100000`;
      await tx`insert into public.reservations(user_id,token_id,estimate,created_at)
      select ${session.user_id},${identity.id},'[]'::jsonb,now()-interval '10 minutes' from generate_series(1,${used})`;
      const ctx = {
        actor_kind: "pat",
        token_hash: tokenHash,
        remote: false,
        idempotency_key: randomUUID(),
        request_hash: hash("batch"),
      };
      const input = {
        mode: "simple",
        prompt: "Reservation rate test",
        lyrics: "",
        styles: "",
        languages: ["it"],
        vocalGender: null,
        settings: { engine: "kie" },
        count: 4,
      };
      const count = async () =>
        (
          await tx`select count(*)::int as n from public.reservations where token_id=${identity.id}`
        )[0].n;
      const result = await call(tx, "mdf_web", "song_create", [ctx, input]);
      if (used === 16) {
        expect(result.ok).toBe(true);
        expect(result.data.jobs).toHaveLength(4);
        expect(await count()).toBe(20);
        expect(await call(tx, "mdf_web", "song_create", [ctx, input])).toEqual(
          result,
        );
        const [existing] =
          await tx`select ops.reserve_job(${result.data.jobs[0].job_id}) as id`;
        expect(existing.id).toBeTruthy();
        expect(await count()).toBe(20);
      } else {
        expect(result).toMatchObject({ ok: false, code: "rate_limited" });
        expect(result.details.retry_after).toBeGreaterThan(0);
        expect(result.details.retry_after).toBeLessThanOrEqual(3000);
        expect(await count()).toBe(18);
        expect(
          await tx`select id from public.jobs where owner_id=${session.user_id}`,
        ).toEqual([]);
      }
      const next = { ...ctx, idempotency_key: randomUUID() };
      expect(
        await call(tx, "mdf_web", "song_create", [next, input]),
      ).toMatchObject({ ok: false, code: "rate_limited" });
      await tx`update public.reservations set created_at=now()-interval '61 minutes' where token_id=${identity.id}`;
      expect(
        await call(tx, "mdf_web", "song_create", [next, input]),
      ).toMatchObject({ ok: true });
    });
  },
);
