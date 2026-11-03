import { type OpsErrorCode, t } from "@mellodifai/shared";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { ActionResult } from "./action-result";
import { actionProfile } from "./auth";
import { getLocale } from "./locale";
import { sessionCtx } from "./ops/context";
import { runOp } from "./ops/run";
import type { OpDef } from "./ops/types";
import { isRemote } from "./remote";

type LegacyWork = (
  db: Awaited<ReturnType<typeof actionProfile>>["supabase"],
) => Promise<{
  versionId?: string;
  projectId?: string;
  // Overrides the id the result carries (a new playlist, for instance).
  id?: string;
  count?: number;
}>;

export function runAction(work: LegacyWork): Promise<ActionResult>;
export function runAction<I, O>(
  def: OpDef<I, O>,
  input: unknown,
  options?: { idempotencyKey?: string },
): Promise<ActionResult>;
export async function runAction<I, O>(
  defOrWork: OpDef<I, O> | LegacyWork,
  input?: unknown,
  options?: { idempotencyKey?: string },
): Promise<ActionResult> {
  try {
    if (isRemote(await headers())) return opsFailure("forbidden_scope");
  } catch {
    return opsFailure("internal");
  }
  if (typeof defOrWork !== "function")
    return remoteAction(defOrWork, input, options);
  return legacyAction(defOrWork);
}

async function opsFailure(code: OpsErrorCode): Promise<ActionResult> {
  return { ok: false, code, error: t(await getLocale(), `error.${code}`) };
}

export async function remoteAction<I, O>(
  def: OpDef<I, O>,
  input: unknown,
  options?: { idempotencyKey?: string },
): Promise<ActionResult> {
  try {
    const ctx = await sessionCtx();
    const result = await runOp(
      def,
      { ...ctx, idempotency_key: options?.idempotencyKey },
      input,
    );
    if (!result.ok)
      return {
        ...(await opsFailure(result.code)),
        ...(result.idempotency_key
          ? { idempotencyKey: result.idempotency_key }
          : {}),
      };
    if ("committed" in result) return { ok: true, committed: true };
    const data = result.data;
    const id =
      data && typeof data === "object"
        ? "project_id" in data
          ? data.project_id
          : "playlist_id" in data
            ? data.playlist_id
            : "id" in data
              ? data.id
              : undefined
        : undefined;
    const count =
      data && typeof data === "object" && "count" in data
        ? data.count
        : undefined;
    return {
      ok: true,
      ...(typeof id === "string" ? { id } : {}),
      ...(typeof count === "number" ? { count } : {}),
    };
  } catch {
    return opsFailure("unauthorized");
  }
}

async function legacyAction(work: LegacyWork): Promise<ActionResult> {
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
    const resultId = result.id ?? projectId;
    revalidatePath("/library");
    revalidatePath("/create");
    revalidatePath("/playlists");
    revalidatePath("/playlists/[id]", "page");
    revalidatePath("/search");
    revalidatePath("/stems/[id]", "page");
    revalidatePath("/editor/[id]", "page");
    return {
      ok: true,
      ...(resultId ? { id: resultId } : {}),
      ...(result.count === undefined ? {} : { count: result.count }),
    };
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
