import { WorkerLoop } from "../../src/loop.js";

// Unit fixtures provide mock engines and handlers. Register those handlers in
// both tables so the test process can retain the runtime's WORKER_FAKE=1 guard.
// Explicit fake registries still win in tests that compare the two paths.
export function workerWithTestStages(
  options: ConstructorParameters<typeof WorkerLoop>[0],
): WorkerLoop {
  return new WorkerLoop({
    ...options,
    fakeStages: options.fakeStages ?? options.stages,
    ...((options.fakeSongless ?? options.songless)
      ? { fakeSongless: options.fakeSongless ?? options.songless }
      : {}),
  });
}
