import { define, JobsResult } from "./base";
import { RequestVisualizerInput } from "./inputs";

export const visualizerRequest = define(
  "visualizer_request",
  RequestVisualizerInput,
  (v) => [v.versionId, v.params],
  JobsResult,
  "create",
  false,
);
