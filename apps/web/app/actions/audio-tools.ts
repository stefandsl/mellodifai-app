"use server";
import { stemsRequest } from "@/lib/ops/defs/stems-request";
import { takeSaveEdit } from "@/lib/ops/defs/take-save-edit";
import { runAction } from "@/lib/run-action";

export async function requestStems(input: unknown) {
  return runAction(stemsRequest, input);
}

export async function saveEditedTake(input: unknown) {
  return runAction(takeSaveEdit, input);
}
