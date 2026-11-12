import { z } from "zod";
import { SectionKeepInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const sectionEditKeep = define(
  "section_edit_keep",
  SectionKeepInput,
  (v) => [v.editId, v.alternative],
  JobsResult.extend({ take_id: z.string().uuid() }),
  "create",
  false,
);
