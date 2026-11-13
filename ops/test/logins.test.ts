import { beforeEach as beforeDockerCase, vi as legacyRuntime } from "vitest";

beforeDockerCase(() => legacyRuntime.stubEnv("MELLODIFAI_RUNTIME", "docker"));

import { expect, it } from "vitest";
import { loginPasswords } from "../lib/logins.js";

it("uses the compose password for active service roles and independent persistent values for unused logins", () => {
  const passwords = loginPasswords(
    ["postgres", "authenticator", "supabase_etl_admin", "mdf_web"],
    "shared",
    { supabase_etl_admin: "saved", mdf_web: "web" },
  );
  expect(passwords).toMatchObject({
    postgres: "shared",
    authenticator: "shared",
    supabase_etl_admin: "saved",
    mdf_web: "web",
  });
  const added = loginPasswords(["unused"], "shared", {});
  expect(added.unused).toHaveLength(64);
});
