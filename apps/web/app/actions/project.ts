"use server";
import { adminProjectCreate } from "@/lib/ops/defs/admin-project-create";
import { runAction } from "@/lib/run-action";

export async function createProject(input: unknown) {
  return runAction(adminProjectCreate, input);
}
