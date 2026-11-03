import { expect, it } from "vitest";
import { dumpTables } from "../lib/recovery.js";

it("restores only tables recorded in a data-only dump", () => {
  expect([
    ...dumpTables(
      "COPY auth.users (id) FROM stdin;\nCOPY public.projects (id) FROM stdin;\n",
    ),
  ]).toEqual(["auth.users", "public.projects"]);
  expect(() => dumpTables("COPY outside.secret (id) FROM stdin;\n")).toThrow();
  expect(() => dumpTables("-- empty dump\n")).toThrow();
});
