import { z } from "zod";
import { CreateProjectInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const adminProjectCreate = define(
  "admin_project_create",
  CreateProjectInput,
  (v) => [
    v.topic,
    v.brief,
    [...new Set(v.languages)],
    v.style,
    v.mood,
    v.vocalGender,
  ],
  JobsResult.extend({ project_id: z.string().uuid() }),
  "admin",
  false,
);
