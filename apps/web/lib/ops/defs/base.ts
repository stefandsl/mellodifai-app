import { JobRef } from "@mellodifai/shared";
import { z } from "zod";
import type { OpDef } from "../types";

export const JobsResult = z.object({
  jobs: z.array(JobRef),
});

export const VideoApprovalResult = z.union([
  z.object({ version_id: z.string().uuid(), status: z.string() }),
  JobsResult,
]);

export function define<I extends z.ZodType, O extends z.ZodType>(
  name: string,
  input: I,
  args: (value: z.infer<I>) => unknown[],
  output: O,
  scope: OpDef<z.infer<I>, z.infer<O>>["scope"] = "create",
  reservesPaidWork = false,
): OpDef<z.infer<I>, z.infer<O>> {
  return {
    name,
    fn: name,
    input: input as z.ZodType<z.infer<I>>,
    args,
    output: output as z.ZodType<z.infer<O>>,
    scope,
    key: true,
    mutating: true,
    reservesPaidWork,
    revalidate: (data) =>
      data &&
      typeof data === "object" &&
      "project_id" in data &&
      typeof data.project_id === "string"
        ? [`/projects/${data.project_id}`]
        : [],
  };
}
