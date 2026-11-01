import { stageAllowed } from "@mellodifai/shared";
import type { Db, Job, Project, Version } from "./db.js";
export class AuthorizationDenied extends Error {}

export async function authorizeStage(
  db: Db,
  job: Job,
  version: Version,
  project: Project,
) {
  if (
    !job.owner_id ||
    job.owner_id !== version.owner_id ||
    job.owner_id !== project.owner_id
  )
    throw new AuthorizationDenied("Job ownership mismatch");
  if (!stageAllowed(version.status, job.stage))
    throw new AuthorizationDenied(
      `Stage ${job.stage} not allowed for ${version.status}`,
    );
  const check = async (value: unknown, key = ""): Promise<void> => {
    if (Array.isArray(value)) {
      for (const item of value) await check(item, key);
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) await check(v, k);
      return;
    }
    if (
      !/(?:id|ids)$/iu.test(key) &&
      !(
        typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(value)
      )
    )
      return;
    if (typeof value !== "string")
      throw new AuthorizationDenied("Invalid payload id");
    const name = key.replaceAll("_", "").toLowerCase();
    if (
      (name === "ownerid" && value === job.owner_id) ||
      (name === "versionid" && value === version.id) ||
      (name === "projectid" && value === project.id)
    )
      return;
    if (name === "takeid") {
      const take = (await db.getTakes(version.id)).find((t) => t.id === value);
      if (take?.owner_id === job.owner_id) return;
    }
    if (name === "renderid") {
      for (const kind of ["master", "hook"] as const) {
        const r = await db.getRender(version.id, kind);
        if (r?.id === value && r.owner_id === job.owner_id) return;
      }
      // A Video Studio render of this song (one per aspect, outside the render attempts).
      const visualizer = await db.getRenderById(value);
      if (
        visualizer?.kind === "visualizer" &&
        visualizer.version_id === version.id &&
        visualizer.owner_id === job.owner_id
      )
        return;
    }
    if (name === "publicationid") {
      const p = await db.getPublicationForVersion(version.id);
      if (p?.id === value && p.owner_id === job.owner_id) return;
    }
    throw new AuthorizationDenied("Unauthorized payload id");
  };
  await check(job.payload ?? {});
}
