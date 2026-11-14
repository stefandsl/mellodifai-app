import { expect, it, vi } from "vitest";
import { lastResort } from "../../lib/native/supervisor.js";

it("stops every child before exiting on an uncaught supervisor error, once", async () => {
  const order: string[] = [];
  let finish = () => {};
  const stop = vi.fn(
    () =>
      new Promise<void>((done) => {
        order.push("stop");
        finish = () => {
          order.push("stopped");
          done();
        };
      }),
  );
  const exited = new Promise<number>((resolve) => {
    const handler = lastResort(
      stop,
      (message) => order.push(message.split(";")[0] as string),
      (code) => {
        order.push("exit");
        resolve(code);
      },
    );
    handler(new Error("ENOSPC: write failed in a stream handler"));
    handler(new Error("second error"));
  });
  await new Promise((done) => setTimeout(done, 20));
  expect(order).not.toContain("exit");
  finish();
  expect(await exited).toBe(1);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(order.slice(1)).toEqual(["stop", "stopped", "exit"]);
});

it("exits even when stopping the children fails or hangs", async () => {
  const failing = new Promise<number>((resolve) =>
    lastResort(
      () => Promise.reject(new Error("stop failed")),
      () => {
        throw new Error("log unavailable");
      },
      resolve,
    )(new Error("boom")),
  );
  expect(await failing).toBe(1);
  const hanging = new Promise<number>((resolve) =>
    lastResort(
      () => new Promise<void>(() => {}),
      () => {},
      resolve,
      30,
    )("boom"),
  );
  expect(await hanging).toBe(1);
});
