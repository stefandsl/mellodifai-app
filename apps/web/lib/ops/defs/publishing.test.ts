import { expect, it } from "vitest";
import { TOKEN_OPS } from "../registry";
import { PublishPlanInput, PublishScheduleInput } from "./publishing";

it("gives agents plan, preview, schedule, request, veto, cancel and status, never approval or rules", () => {
  const publishing = Object.fromEntries(
    TOKEN_OPS.filter((def) => def.name.startsWith("publish")).map((def) => [
      def.name,
      def.scope,
    ]),
  );
  expect(publishing).toEqual({
    publish_plan: "create",
    publish_status: "read",
    publish_preview: "read",
    publish_draft_edit: "create",
    publish_schedule: "create",
    publish_request_approval: "spend",
    publish_veto: "create",
    publish_cancel: "create",
  });
  for (const def of TOKEN_OPS.filter((d) => d.name.startsWith("publish")))
    expect(def.description, def.name).toContain(`(scope ${def.scope}`);
  expect(TOKEN_OPS.map((def) => def.fn)).not.toContain(
    "publish_approval_decide",
  );
  expect(TOKEN_OPS.some((def) => def.fn.startsWith("publish_rule"))).toBe(
    false,
  );
});

it("plans YouTube by default and refuses unknown platforms, fields and slots without an offset", () => {
  const version_id = crypto.randomUUID();
  expect(PublishPlanInput.parse({ version_id }).platforms).toEqual(["youtube"]);
  expect(
    PublishPlanInput.safeParse({ version_id, platforms: ["myspace"] }).success,
  ).toBe(false);
  expect(
    PublishPlanInput.safeParse({ version_id, draft: { privacy: "public" } })
      .success,
  ).toBe(false);
  const schedule_id = crypto.randomUUID();
  expect(
    PublishScheduleInput.safeParse({ schedule_id, slot_at: "2026-11-21 18:00" })
      .success,
  ).toBe(false);
  expect(
    PublishScheduleInput.safeParse({
      schedule_id,
      slot_at: "2026-11-21T18:00:00+01:00",
    }).success,
  ).toBe(true);
});
