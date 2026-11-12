import { SectionIdInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const sectionEditDiscard = define(
  "section_edit_discard",
  SectionIdInput,
  (v) => [v.editId],
  JobsResult,
  "create",
  false,
);
