// The plans of the public site: which plan is recommended and what each plan holds in the compare
// table. Words live in copy.ts (Italian and English); this file holds only the structure.
// Prices are the owner's decision (D1): until then every price shows copy.plans.price.

export const PERIODS = ["monthly", "yearly"] as const;
export type Period = (typeof PERIODS)[number];

/** Index of the recommended plan in copy.plans.items (four plans). */
export const RECOMMENDED_PLAN = 2;
export const PLAN_COUNT = 4;

/** A cell: included, not included, or a short text (a key of copy.pricing.cells). */
export type CompareCell = boolean | CellText;
export type CellText = "guides" | "email" | "faster";

export const COMPARE = [
  {
    group: "songs",
    rows: [
      { row: "prompt", cells: [true, true, true, true] },
      { row: "link", cells: [false, true, true, true] },
      { row: "recipes", cells: [false, true, true, true] },
    ],
  },
  {
    group: "editing",
    rows: [
      { row: "word", cells: [true, true, true, true] },
      { row: "section", cells: [false, true, true, true] },
      { row: "takes", cells: [false, true, true, true] },
    ],
  },
  {
    group: "voice",
    rows: [
      { row: "stems", cells: [false, false, true, true] },
      { row: "translate", cells: [false, true, true, true] },
      { row: "karaoke", cells: [false, true, true, true] },
    ],
  },
  {
    group: "publishing",
    rows: [
      { row: "mp3", cells: [true, true, true, true] },
      { row: "video", cells: [false, true, true, true] },
      { row: "channels", cells: [false, false, false, true] },
    ],
  },
  {
    group: "agents",
    rows: [
      { row: "desktop", cells: [false, false, true, true] },
      { row: "agentAccess", cells: [false, false, true, true] },
      { row: "songbook", cells: [false, false, false, true] },
      { row: "help", cells: ["guides", "email", "email", "faster"] },
    ],
  },
] as const satisfies readonly {
  group: string;
  rows: readonly { row: string; cells: readonly CompareCell[] }[];
}[];

export type CompareGroup = (typeof COMPARE)[number]["group"];
export type CompareRow = (typeof COMPARE)[number]["rows"][number]["row"];
