import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CrossfadeCover } from "./crossfade-cover";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("glass");
});

it("keeps the old cover for the short transition", () => {
  vi.useFakeTimers();
  const view = render(<CrossfadeCover art="red" />);
  view.rerender(<CrossfadeCover art="blue" />);
  expect(view.container.querySelectorAll("[style]")).toHaveLength(2);
  act(() => vi.advanceTimersByTime(400));
  expect(view.container.querySelectorAll("[style]")).toHaveLength(1);
});

it("waits for the next cover to decode before fading", async () => {
  vi.useFakeTimers();
  document.documentElement.classList.add("glass");
  let load: (() => void) | undefined;
  let decode: (() => void) | undefined;
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      constructor() {
        load = () => this.onload?.();
      }
      decode() {
        return new Promise<void>((resolve) => {
          decode = resolve;
        });
      }
    },
  );
  const view = render(<CrossfadeCover art="red" coverUrl="old.png" />);
  view.rerender(<CrossfadeCover art="blue" coverUrl="new.png" />);
  expect(
    view.container.querySelector(".cover-enter")?.getAttribute("style"),
  ).toContain("red");
  act(() => load?.());
  act(() => vi.advanceTimersByTime(500));
  expect(
    view.container.querySelector(".cover-enter")?.getAttribute("style"),
  ).toContain("red");
  await act(async () => decode?.());
  expect(
    view.container.querySelector(".cover-enter")?.getAttribute("style"),
  ).toContain("blue");
  expect(view.container.querySelectorAll("[style]")).toHaveLength(2);
});
