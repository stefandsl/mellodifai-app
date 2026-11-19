"use server";
import {
  publishApprovalDecide,
  publishCancel,
  publishDraftEdit,
  publishPlan,
  publishRequestApproval,
  publishRuleDelete,
  publishRuleSave,
  publishSchedule,
  publishVeto,
} from "@/lib/ops/defs/publishing";
import { runAction } from "@/lib/run-action";

// "Pubblica" for the owner's own session. The database checks a local admin session; the owner's
// own request counts as his yes, an agent's request waits for publishApproval.

export async function planPublication(input: unknown) {
  return runAction(publishPlan, input);
}

export async function editPublicationDraft(input: unknown) {
  return runAction(publishDraftEdit, input);
}

export async function setPublicationSlot(input: unknown) {
  return runAction(publishSchedule, input);
}

export async function requestPublication(input: unknown) {
  return runAction(publishRequestApproval, input);
}

export async function vetoPublication(input: unknown) {
  return runAction(publishVeto, input);
}

export async function cancelPublication(input: unknown) {
  return runAction(publishCancel, input);
}

export async function decidePublication(input: unknown) {
  return runAction(publishApprovalDecide, input);
}

export async function savePublishRule(input: unknown) {
  return runAction(publishRuleSave, input);
}

export async function deletePublishRule(input: unknown) {
  return runAction(publishRuleDelete, input);
}
