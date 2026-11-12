import { z } from "zod";
import { ChooseTakeInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const takeChoose = define(
  "take_choose",
  ChooseTakeInput,
  (v) => [v.versionId, v.takeId],
  JobsResult.extend({ version_id: z.string().uuid() }),
  "create",
  false,
);
