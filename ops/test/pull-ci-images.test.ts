import { expect, it } from "vitest";
import { recordingRunner } from "../lib/run.js";
import { pullCiImages } from "../pull-ci-images.js";

it("pulls immutable mirrors once and retags the exact rendered image names", async () => {
  const runner = recordingRunner();
  const image = "public.ecr.aws/supabase/postgres:17.11.0.006";
  await pullCiImages([image, image], runner);
  expect(runner.calls).toEqual([
    {
      cmd: "docker",
      args: [
        "pull",
        expect.stringMatching(
          /^docker\.io\/supabase\/postgres@sha256:[a-f0-9]{64}$/,
        ),
      ],
    },
    {
      cmd: "docker",
      args: ["tag", expect.stringContaining("@sha256:"), image],
    },
  ]);
});

it("refuses unverified pins before pulling anything and stops on pull failure", async () => {
  const runner = recordingRunner();
  await expect(pullCiImages(["unknown:latest"], runner)).rejects.toThrow(
    "Unverified",
  );
  expect(runner.calls).toEqual([]);
  const failed = recordingRunner([
    { code: 1, stdout: "", stderr: "rate limited" },
  ]);
  await expect(
    pullCiImages(["public.ecr.aws/supabase/postgres:17.11.0.006"], failed),
  ).rejects.toThrow("Image pull failed");
  expect(failed.calls).toHaveLength(1);
});
