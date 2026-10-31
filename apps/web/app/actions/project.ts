"use server";
import { runAction } from "@/lib/run-action";
import { CreateProjectInput } from "./schemas";
export async function createProject(input: unknown) {
  return runAction(async (db) => {
    const v = CreateProjectInput.parse(input);
    const { data, error } = await db.rpc("create_project", {
      p_topic: v.topic,
      p_brief: v.brief,
      p_languages: [...new Set(v.languages)],
      p_style: v.style,
      p_mood: v.mood,
      p_vocal_gender: v.vocalGender,
    });
    if (error) throw error;
    return { projectId: data as string };
  });
}
