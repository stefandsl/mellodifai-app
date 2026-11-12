import { expect, it } from "vitest";
import { dumpTables } from "../lib/recovery.js";

it("restores only tables recorded in a data-only dump", () => {
  expect([
    ...dumpTables(
      "COPY auth.users (id) FROM stdin;\nCOPY public.projects (id) FROM stdin;\n",
    ),
  ]).toEqual(["auth.users", "public.projects"]);
  expect(() => dumpTables("COPY outside.secret (id) FROM stdin;\n")).toThrow();
  expect([
    ...dumpTables(
      "-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: postgres\n" +
        "-- Data for Name: empty_table; Type: TABLE DATA; Schema: public; Owner: postgres\n" +
        'INSERT INTO "auth"."users" ("id") VALUES (1);\n',
    ),
  ]).toEqual(["auth.users", "public.empty_table"]);
  expect(() => dumpTables("-- empty dump\n")).toThrow();
});
