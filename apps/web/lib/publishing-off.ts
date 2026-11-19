// MDF_PUBLISHING=off (the desktop app until its owner configured his own engine and YouTube
// credentials): nothing may move a video toward YouTube. The worker refuses the upload and
// the privacy change and runs no publishing clock; here the ops that plan, approve, schedule
// or confirm a publication are refused and the Pubblica pages say why. Vetoes, cancels and
// rule deletions stay allowed: they only take publishing away.
export const PUBLISHING_OFF_MESSAGE =
  "La pubblicazione e' spenta su questa installazione di MellodifAI: usa il tuo motore e le tue credenziali YouTube (MELLODIFAI_ENGINE_ROOT e MELLODIFAI_PUBLISHING=on in Le tue chiavi), poi riavvia MellodifAI.";

export const PUBLISHING_OPS: ReadonlySet<string> = new Set([
  "publish_plan",
  "publish_draft_edit",
  "publish_schedule",
  "publish_request_approval",
  "publish_approval_decide",
  "publish_reopen",
  "publish_rule_save",
  "admin_enqueue_publish",
  "admin_confirm_publication",
]);

export function publishingOff(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MDF_PUBLISHING === "off";
}
