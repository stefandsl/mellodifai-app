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
    revalidatePath("/create");
    return { ok: true, ...(projectId ? { id: projectId } : {}) };
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : String(error);
    console.error(
      "Server action failed:",
      message
        .replace(
          /\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
          "[redacted]",
        )
        .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/gu, "[redacted]"),
    );
    return { ok: false, error: t(await getLocale(), "error.action") };
  }
}
