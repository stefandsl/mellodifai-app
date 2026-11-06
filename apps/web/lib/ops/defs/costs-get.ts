import { CostsGetInput, CostsSummary } from "@mellodifai/shared";
import type { z } from "zod";
import type { OpDef } from "../types";

export const costsGet: OpDef<
  z.infer<typeof CostsGetInput>,
  z.infer<typeof CostsSummary>
> = {
  name: "costs_get",
  fn: "costs_get",
  input: CostsGetInput,
  args: (v) => [v.from ?? null, v.to ?? null],
  output: CostsSummary,
  scope: "read",
  key: false,
  mutating: false,
  revalidate: () => [],
};
