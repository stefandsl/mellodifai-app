import { z } from "zod";
import { SaveEditInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const takeSaveEdit = define(
  "take_save_edit",
  SaveEditInput,
  (v) => [v.versionId, v.path],
  JobsResult.extend({ take_id: z.string().uuid() }),
  "create",
  false,
);
