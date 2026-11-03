import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CrossfadeCover } from "./crossfade-cover";

afterEach(() => vi.useRealTimers());

it("keeps the old cover for the short transition", () => {
  vi.useFakeTimers();
  const view = render(<CrossfadeCover art="red" />);
  view.rerender(<CrossfadeCover art="blue" />);
  expect(view.container.querySelectorAll("[style]")).toHaveLength(2);
  act(() => vi.advanceTimersByTime(400));
  expect(view.container.querySelectorAll("[style]")).toHaveLength(1);
});
