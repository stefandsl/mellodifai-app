import { PLATFORMS } from "@mellodifai/shared";
import { z } from "zod";
import type { OpDef } from "../types";

// "Pubblica" (migration 20261119000001). Every operation answers with the schedule view; the
// database owns the states, the veto window, the approval card and the standing rules.

const Id = z.string().uuid();
const When = z.string();
const Issue = z.object({
  field: z.string(),
  code: z.string(),
  limit: z.number().optional(),
});
export const PublishDraft = z.object({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  thumbnail_text: z.string(),
});
export const ScheduleState = z.enum([
  "draft",
  "awaiting_approval",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "held",
  "vetoed",
  "cancelled",
  "rejected",
  "expired",
]);
export const ScheduleView = z.object({
  schedule_id: Id,
  version_id: Id,
  project_id: Id,
  render_id: Id,
  lang: z.string(),
  state: ScheduleState,
  revision: z.number().int(),
  slot_at: When.nullable(),
  veto_deadline_at: When.nullable(),
  veto_open: z.boolean(),
  held_reason: z.string().nullable(),
  // null: a destination without a known price; no card or rule covers it.
  price_eur: z.number().nullable(),
  created_via: z.string(),
  vetoed_at: When.nullable(),
  media: z
    .object({
      state: z.string(),
      video_id: z.string().nullable(),
      privacy: z.string().nullable(),
    })
    .nullable(),
  approval: z
    .object({
      approval_id: Id,
      state: z.enum(["pending", "approved", "rejected", "expired"]),
      summary: z.string(),
      price_eur: z.number(),
      platforms: z.array(z.string()),
      requested_via: z.string(),
      expires_at: When,
      decided_at: When.nullable(),
      decided_via: z.string().nullable(),
    })
    .nullable(),
  destinations: z.array(
    z.object({
      destination_id: Id,
      platform: z.enum(PLATFORMS),
      provider: z.string(),
      account_id: z.string(),
      state: z.string(),
      draft: PublishDraft,
      problems: z.array(Issue),
      external_url: z.string().nullable(),
      published_at: When.nullable(),
      error: z.string().nullable(),
    }),
  ),
  events: z.array(
    z.object({
      at: When,
      kind: z.string(),
      actor: z.string(),
      detail: z.record(z.string(), z.unknown()),
    }),
  ),
  created_at: When,
  updated_at: When,
});
export type ScheduleView = z.infer<typeof ScheduleView>;

const DraftEdit = z
  .object({
    title: z.string().max(200),
    description: z.string().max(10_000),
    tags: z.array(z.string().max(200)).max(100),
    thumbnail_text: z.string().max(200),
  })
  .partial()
  .strict();

export const PublishPlanInput = z.object({
  version_id: Id,
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(9).default(["youtube"]),
  draft: DraftEdit.optional(),
});
export const PublishScheduleRef = z.object({ schedule_id: Id });
export const PublishDraftEditInput = z.object({
  schedule_id: Id,
  platform: z.enum(PLATFORMS).default("youtube"),
  draft: DraftEdit,
});
export const PublishScheduleInput = z.object({
  schedule_id: Id,
  slot_at: z.string().datetime({ offset: true }),
});
export const PublishStatusInput = z.object({ version_id: Id });

const revalidateView = (data: ScheduleView) => [
  `/projects/${data.project_id}`,
  `/projects/${data.project_id}/publish`,
];
function write<I>(
  name: string,
  input: z.ZodType<I>,
  args: (value: I) => unknown[],
  scope: "create" | "spend",
): OpDef<I, ScheduleView> {
  return {
    name,
    fn: name,
    input,
    args,
    output: ScheduleView,
    scope,
    key: true,
    mutating: true,
    revalidate: revalidateView,
  };
}

export const publishPlan = write(
  "publish_plan",
  PublishPlanInput,
  (v) => [v.version_id, v.platforms, v.draft ?? {}],
  "create",
);
export const publishDraftEdit = write(
  "publish_draft_edit",
  PublishDraftEditInput,
  (v) => [v.schedule_id, v.platform, v.draft],
  "create",
);
export const publishSchedule = write(
  "publish_schedule",
  PublishScheduleInput,
  (v) => [v.schedule_id, v.slot_at],
  "create",
);
// Files the approval card; the owner's yes (or a standing rule he wrote) schedules it.
export const publishRequestApproval = write(
  "publish_request_approval",
  PublishScheduleRef,
  (v) => [v.schedule_id],
  "spend",
);
export const publishVeto = write(
  "publish_veto",
  PublishScheduleRef,
  (v) => [v.schedule_id],
  "create",
);
export const publishCancel = write(
  "publish_cancel",
  PublishScheduleRef,
  (v) => [v.schedule_id],
  "create",
);
export const publishPreview: OpDef<
  z.infer<typeof PublishScheduleRef>,
  ScheduleView
> = {
  name: "publish_preview",
  fn: "publish_preview",
  input: PublishScheduleRef,
  args: (v) => [v.schedule_id],
  output: ScheduleView,
  scope: "read",
  key: false,
  mutating: false,
  revalidate: () => [],
};
export const PublishStatus = z.object({
  version_id: Id,
  schedules: z.array(ScheduleView),
});
export const publishStatus: OpDef<
  z.infer<typeof PublishStatusInput>,
  z.infer<typeof PublishStatus>
> = {
  name: "publish_status",
  fn: "publish_status",
  input: PublishStatusInput,
  args: (v) => [v.version_id],
  output: PublishStatus,
  scope: "read",
  key: false,
  mutating: false,
  revalidate: () => [],
};

// Owner only (local admin session): never in the token registry, so no agent can call them.
export const PublishApprovalDecideInput = z.object({
  approvalId: Id,
  decision: z.enum(["approve", "reject"]),
});
export const publishApprovalDecide: OpDef<
  z.infer<typeof PublishApprovalDecideInput>,
  ScheduleView
> = {
  name: "publish_approval_decide",
  fn: "publish_approval_decide",
  input: PublishApprovalDecideInput,
  args: (v) => [v.approvalId, v.decision],
  output: ScheduleView,
  scope: "admin",
  key: true,
  mutating: true,
  revalidate: (data) => [...revalidateView(data), "/settings/publishing"],
};
export const PublishRule = z.object({
  rule_id: Id,
  platform: z.enum(PLATFORMS),
  max_price_eur: z.number(),
  require_veto_hours: z.number().int(),
  active: z.boolean(),
  created_at: When,
});
export const PublishRules = z.object({
  rules: z.array(PublishRule),
  approvals: z.array(ScheduleView),
});
export const publishRulesList: OpDef<
  Record<string, never>,
  z.infer<typeof PublishRules>
> = {
  name: "publish_rules_list",
  fn: "publish_rules_list",
  input: z.object({}).strict(),
  args: () => [],
  output: PublishRules,
  scope: "admin",
  key: false,
  mutating: false,
  revalidate: () => [],
};
export const PublishRuleSaveInput = z.object({
  rule_id: Id.optional(),
  platform: z.enum(PLATFORMS),
  max_price_eur: z.number().min(0).max(1000),
  require_veto_hours: z.number().int().min(1).max(168),
  active: z.boolean(),
});
export const publishRuleSave: OpDef<
  z.infer<typeof PublishRuleSaveInput>,
  { rule_id: string }
> = {
  name: "publish_rule_save",
  fn: "publish_rule_save",
  input: PublishRuleSaveInput,
  args: (v) => [v],
  output: z.object({ rule_id: Id }),
  scope: "admin",
  key: true,
  mutating: true,
  revalidate: () => ["/settings/publishing"],
};
export const publishRuleDelete: OpDef<{ ruleId: string }, { rule_id: string }> =
  {
    name: "publish_rule_delete",
    fn: "publish_rule_delete",
    input: z.object({ ruleId: Id }),
    args: (v) => [v.ruleId],
    output: z.object({ rule_id: Id }),
    scope: "admin",
    key: true,
    mutating: true,
    revalidate: () => ["/settings/publishing"],
  };
