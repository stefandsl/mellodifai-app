import { z } from "zod";
import { SectionEditInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const sectionEditRequest = define(
  "section_edit_request",
  SectionEditInput,
  (v) => [
    v.versionId,
    v.takeId,
    v.engine,
    Math.round(v.start * 100) / 100,
    Math.round(v.end * 100) / 100,
    Math.round(v.duration * 100) / 100,
    v.lines,
    v.section,
    v.full,
  ],
  JobsResult.extend({ edit_id: z.string().uuid() }),
  "create",
  true,
);
