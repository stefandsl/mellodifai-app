import { PublicationInput } from "@/app/actions/schemas";
import { define, JobsResult } from "./base";

export const adminEnqueuePublish = define(
  "admin_enqueue_publish",
  PublicationInput,
  (v) => [v.renderId, v.metadata],
  JobsResult,
  "admin",
  false,
);
