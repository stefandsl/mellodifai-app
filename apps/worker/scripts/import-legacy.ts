import { createClient } from "@supabase/supabase-js";
import {
  createLegacyFiles,
  importLegacy,
  LEGACY_PROJECT_BRIEF,
  type LegacyImportDb,
} from "../src/legacy-import.js";
import { loadSecrets } from "../src/secrets.js";
import { SupabaseStorage } from "../src/storage.js";

function ownerArgument(args: string[]) {
  const index = args.indexOf("--owner");
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const ownerId = ownerArgument(process.argv.slice(2));
  if (!ownerId)
    throw new Error("Usage: import-legacy.ts --owner <admin user id>");
  const secrets = await loadSecrets();
  const url = secrets.values.SUPABASE_URL;
  const key = secrets.values.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const client = createClient(url, key);
  const db: LegacyImportDb = {
    async isComplete(projectId, lang) {
      const { data, error } = await client
        .from("versions")
        .select("id, renders(qa_results)")
        .eq("project_id", projectId)
        .eq("lang", lang)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (
        data?.renders.some(
          (render) => render.qa_results?.importComplete === true,
        ) ?? false
      );
    },
    async markComplete(versionId) {
      const { error } = await client
        .from("renders")
        .update({
          qa_results: { gates: [], imported: true, importComplete: true },
        })
        .eq("version_id", versionId)
        .eq("kind", "master")
        .eq("render_attempt", 1);
      if (error) throw new Error(error.message);
    },
    async findProject(owner, topic) {
      const { data, error } = await client
        .from("projects")
        .select("id")
        .eq("owner_id", owner)
        .eq("topic", topic)
        .eq("theme", "vbp")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data) return data;
      // Resume a partially completed import created before the naming correction.
      const { data: old, error: oldError } = await client
        .from("projects")
        .select("id")
        .eq("owner_id", owner)
        .eq("topic", "Office satire about AI in the workplace")
        .eq("theme", "vbp")
        .maybeSingle();
      if (oldError) throw new Error(oldError.message);
      if (old) {
        const { error: renameError } = await client
          .from("projects")
          .update({ topic, brief: LEGACY_PROJECT_BRIEF })
          .eq("id", old.id);
        if (renameError) throw new Error(renameError.message);
      }
      return old ?? undefined;
    },
    async createProject(owner, topic, brief) {
      const { data, error } = await client
        .from("projects")
        .insert({ owner_id: owner, topic, brief, theme: "vbp" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    async upsertVersion(value) {
      const { data, error } = await client
        .from("versions")
        .upsert(value, { onConflict: "project_id,lang" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    async upsertTake(value) {
      const { data, error } = await client
        .from("takes")
        .upsert(value, { onConflict: "version_id,generation,take_number" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    async setChosenTake(versionId, takeId) {
      const { error } = await client
        .from("versions")
        .update({ chosen_take_id: takeId })
        .eq("id", versionId);
      if (error) throw new Error(error.message);
    },
    async upsertRender(value) {
      const { data: existing, error: lookupError } = await client
        .from("renders")
        .select("id")
        .eq("version_id", value.version_id)
        .eq("kind", value.kind)
        .eq("render_attempt", value.render_attempt)
        .maybeSingle();
      if (lookupError) throw new Error(lookupError.message);
      const request = existing
        ? client.from("renders").update(value).eq("id", existing.id)
        : client.from("renders").insert(value);
      const { error } = await request;
      if (error) throw new Error(error.message);
    },
  };
  const files = createLegacyFiles();
  const storage = new SupabaseStorage(client);
  const upload = async ({
    path,
    localFile,
    contentType,
  }: {
    path: string;
    localFile: string;
    contentType: string;
  }) => {
    await storage.upload(path, localFile, contentType);
  };
  await importLegacy({
    db,
    files: { ...files, upload },
    ownerId,
    onLanguage: (lang) => console.log(`${lang}: imported`),
  });
}

void main().catch(() => {
  console.error("Legacy import failed; check configuration and source files");
  process.exitCode = 1;
});
