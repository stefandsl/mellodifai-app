import { expect, it } from "vitest";
import { jobStatusLine, timelineRows } from "./timeline";

it("lists a re-run stage once, keeping a failed attempt's retry visible", () => {
  const jobs = [
    { id: "1", stage: "timing", status: "completed" },
    { id: "2", stage: "render_master", status: "failed" },
    { id: "3", stage: "timing", status: "running" },
    { id: "4", stage: "render_master", status: "queued" },
  ];
  expect(timelineRows(jobs).map((row) => [row.job.id, row.superseded])).toEqual(
    [
      ["3", false],
      ["2", true],
      ["4", false],
    ],
  );
});

it("keeps pipeline order while a re-render is still re-running later stages", () => {
  const jobs = [
    { id: "1", stage: "generate_song", status: "completed" },
    { id: "2", stage: "timing", status: "completed" },
    { id: "3", stage: "art", status: "completed" },
    { id: "4", stage: "timing", status: "running" },
  ];
  expect(timelineRows(jobs).map((row) => row.job.id)).toEqual(["1", "4", "3"]);
});

const events = [
  { id: 1, job_id: "a", message: "Brano 1 di 2 con YuE2: testo", progress: 40 },
  {
    id: 2,
    job_id: "a",
    message: "events=19 lines=9 -> hook_9x16.ass",
    progress: null,
  },
  { id: 3, job_id: "b", message: "Stems pronti", progress: 100 },
];

it("shows a running job's latest progress, never the engine's raw log lines", () => {
  expect(jobStatusLine({ id: "a", status: "running" }, events)).toEqual({
    progress: 40,
    message: "Brano 1 di 2 con YuE2: testo",
  });
});

it("drops the generic progress text that only repeats the percentage", () => {
  const generic = [
    { id: 1, job_id: "a", message: "Progress: 55%", progress: 55 },
  ];
  expect(jobStatusLine({ id: "a", status: "running" }, generic)).toEqual({
    progress: 55,
  });
});

it("shows nothing beyond the status once a job has finished", () => {
  expect(jobStatusLine({ id: "b", status: "completed" }, events)).toEqual({});
});

it("keeps the last raw line as failure details when the job has no error text", () => {
  expect(jobStatusLine({ id: "a", status: "failed" }, events)).toEqual({
    details: "events=19 lines=9 -> hook_9x16.ass",
  });
  expect(
    jobStatusLine(
      { id: "a", status: "failed", error: "ComfyUI crashed" },
      events,
    ),
  ).toEqual({ details: "ComfyUI crashed" });
});
