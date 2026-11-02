import { SONGLESS_STAGES, stageAllowed } from "@mellodifai/shared";
import type { Db, Job, Project, Version } from "./db.js";
export class AuthorizationDenied extends Error {}

// A job without a song (lyrics_assist) must name a request of its own owner and nothing else.
// Returns false when the request is gone (deleted with its owner).
export async function authorizeSongless(db: Db, job: Job): Promise<boolean> {
  if (!job.owner_id) throw new AuthorizationDenied("Job ownership mismatch");
  if (!SONGLESS_STAGES.includes(job.stage))
    throw new AuthorizationDenied(`Stage ${job.stage} needs a song`);
  const payload = job.payload ?? {};
  const keys = Object.keys(payload);
  const requestId = payload.request_id;
  if (
    keys.length !== 1 ||
    typeof requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(requestId)
  )
    throw new AuthorizationDenied("Invalid payload id");
  const request = await db.getLyricRequest(requestId);
  if (!request) return false;
  if (request.owner_id !== job.owner_id)
    throw new AuthorizationDenied("Unauthorized payload id");
  return true;
}

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
    if (name === "editid") {
      const edit = await db.getSectionEdit(value);
      if (edit?.version_id === version.id && edit.owner_id === job.owner_id)
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
