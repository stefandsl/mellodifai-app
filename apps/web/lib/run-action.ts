import { t } from "@mellodifai/shared";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "./action-result";
import { actionProfile } from "./auth";
import { getLocale } from "./locale";

export async function runAction(
  work: (
    db: Awaited<ReturnType<typeof actionProfile>>["supabase"],
  ) => Promise<{ versionId?: string; projectId?: string }>,
): Promise<ActionResult> {
  try {
    const { supabase } = await actionProfile();
    const result = await work(supabase);
    let projectId = result.projectId;
    if (result.versionId) {
      const { data, error } = await supabase
        .from("versions")
        .select("project_id")
        .eq("id", result.versionId)
        .single();
      if (error) throw error;
      projectId = data.project_id;
    }
    if (projectId) revalidatePath(`/projects/${projectId}`);
    revalidatePath("/library");
    return { ok: true, ...(projectId ? { id: projectId } : {}) };
  } catch (error) {
    console.error(
      "Server action failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, error: t(await getLocale(), "error.action") };
  }
}
