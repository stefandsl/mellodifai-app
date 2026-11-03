import { createHash } from "node:crypto";
import type { OpsResult } from "@mellodifai/shared";
import { revalidatePath } from "next/cache";
import { callOps } from "@/lib/db/ops-client";
import type { OpDef, OpsCtx } from "./types";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export function requestHash(op: string, input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical({ op, input })))
    .digest("hex");
}

export async function runOp<I, O>(
  def: OpDef<I, O>,
  ctx: OpsCtx,
  input: unknown,
): Promise<OpsResult<O>> {
  try {
    const parsed = def.input.safeParse(input);
    if (!parsed.success)
      return { ok: false, code: "validation", message: "Invalid input" };
    const result = await callOps<O>(def.fn, [
      { ...ctx, request_hash: requestHash(def.name, parsed.data) },
      ...def.args(parsed.data),
    ]);
    if (!result.ok) return result;
    const output = def.output.safeParse(result.data);
    if (!output.success)
      return {
        ok: false,
        code: "internal",
        message: "Invalid operation response",
      };
    if (def.mutating) {
      try {
        for (const path of def.revalidate(output.data)) revalidatePath(path);
        for (const path of ["/library", "/create", "/playlists", "/search"])
          revalidatePath(path);
        for (const path of ["/playlists/[id]", "/stems/[id]", "/editor/[id]"])
          revalidatePath(path, "page");
      } catch {
        // The mutation committed. Reporting failure could cause a duplicate paid job.
        console.error("Operation committed, but path revalidation failed");
      }
    }
    return { ok: true, data: output.data };
  } catch {
    return { ok: false, code: "internal", message: "Internal error" };
  }
}
