import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const children: (EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
})[] = [];
vi.mock("node:child_process", () => ({
  spawn: () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    children.push(child);
    return child;
  },
}));

import { LabseEmbedder } from "./embed.js";

beforeEach(() => {
  children.length = 0;
});

describe("LabseEmbedder", () => {
  it("rejects an in-flight embedding when its Python process exits", async () => {
    const embedder = new LabseEmbedder("python");
    const pending = embedder.embed(["line"]);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    const child = children[0];
    if (!child) throw new Error("Missing test process");
    child.stderr.write("ready\n");
    await new Promise((resolve) => setImmediate(resolve));
    child.emit("exit", 1);
    await expect(pending).rejects.toThrow(/LaBSE embedder exited/u);
  });

  it("does not wait if Python exits just after reporting ready", async () => {
    const embedder = new LabseEmbedder("python");
    const pending = embedder.embed(["line"]);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    const child = children[0];
    if (!child) throw new Error("Missing test process");
    child.stderr.write("ready\n");
    child.emit("exit", 1);
    await expect(pending).rejects.toThrow(/LaBSE embedder stopped/u);
  });

  it("ignores a late reply from an exited process after restart", async () => {
    const embedder = new LabseEmbedder("python");
    const first = embedder.embed(["first"]);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    const old = children[0];
    if (!old) throw new Error("Missing first test process");
    old.stderr.write("ready\n");
    await new Promise((resolve) => setImmediate(resolve));
    old.emit("exit", 1);
    await expect(first).rejects.toThrow(/LaBSE embedder exited/u);

    const second = embedder.embed(["second"]);
    await vi.waitFor(() => expect(children).toHaveLength(2));
    const replacement = children[1];
    if (!replacement) throw new Error("Missing replacement test process");
    const request = vi.fn();
    replacement.stdin.on("data", request);
    replacement.stderr.write("ready\n");
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());

    old.stdout.write('{"vectors":[[1]]}\n');
    replacement.stdout.write('{"vectors":[[2]]}\n');
    await expect(second).resolves.toEqual([[2]]);
    embedder.close();
  });

  it("rejects an in-flight embedding when the embedder closes", async () => {
    const embedder = new LabseEmbedder("python");
    const pending = embedder.embed(["line"]);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0]?.stderr.write("ready\n");
    await new Promise((resolve) => setImmediate(resolve));
    embedder.close();
    await expect(pending).rejects.toThrow(/LaBSE embedder closed/u);
  });
});
