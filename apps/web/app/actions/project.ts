"use server";

import { revalidatePath } from "next/cache";

import { actionProfile } from "@/lib/auth";
import { CreateProjectInput } from "./schemas";

export async function createProject(input: unknown) {
  const value = CreateProjectInput.parse(input);
  const { supabase, user } = await actionProfile();
  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      topic: value.topic,
      brief: value.brief,
      style: `${value.style}\n${value.mood}`,
      theme: "vbp",
    })
    .select("id")
    .single();
  if (error || !project)
    throw new Error(error?.message ?? "Unable to create project");
  const versions = value.languages.map((lang) => ({
    project_id: project.id,
    lang,
    lyric_pack: { settings: { vocalGender: value.vocalGender } },
  }));
  const { data: inserted, error: versionsError } = await supabase
    .from("versions")
    .insert(versions)
    .select("id");
  if (versionsError || !inserted)
    throw new Error(versionsError?.message ?? "Unable to create versions");
  const { error: jobsError } = await supabase.from("jobs").insert(
    inserted.map((version) => ({
      owner_id: user.id,
      version_id: version.id,
      stage: "draft_lyrics",
      idempotency_key: `draft_lyrics:${version.id}:1`,
    })),
  );
  if (jobsError) throw new Error(jobsError.message);
  revalidatePath("/library");
  return project.id;
}
