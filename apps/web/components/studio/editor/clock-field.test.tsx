import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ClockField } from "./clock-field";

const field = () => screen.getByLabelText("Inizio");

// A render longer than the scheduler's 5 ms slice: React commits it, yields, and runs the
// passive effects in a later task. The audio editor mounts its fields this way after the
// audio loads, so a keystroke can land between the two.
function SlowMount({ onEffects }: { onEffects: () => void }) {
  const until = performance.now() + 25;
  while (performance.now() < until);
  useEffect(onEffects);
  return <ClockField label="Inizio" value={0} onCommit={() => {}} />;
}

describe("clock field", () => {
  it("keeps what is typed before the effects of its first render run", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    try {
      let effectsRan = false;
      let effectsRanBeforeInput: boolean | null = null;
      // A mutation observer runs right after the commit, before the next scheduler task.
      const cleared = new Promise<HTMLInputElement>((resolve) => {
        const observer = new MutationObserver(() => {
          const input = container.querySelector("input");
          if (!input) return;
          observer.disconnect();
          effectsRanBeforeInput = effectsRan;
          fireEvent.change(input, { target: { value: "" } });
          resolve(input);
        });
        observer.observe(container, { childList: true, subtree: true });
      });
      root.render(
        <SlowMount
          onEffects={() => {
            effectsRan = true;
          }}
        />,
      );
      const input = await cleared;
      await vi.waitFor(() => expect(effectsRan).toBe(true));
      // The test is only worth something when the input did arrive first.
      expect(effectsRanBeforeInput).toBe(false);
      expect(input).toHaveValue("");
    } finally {
      root.unmount();
      container.remove();
    }
  });

  it("shows the value it holds after a commit, whatever was typed", async () => {
    // The owner clamps what it is given: here 9 comes back as the same 5.5.
    const onCommit = vi.fn();
    render(<ClockField label="Inizio" value={5.5} onCommit={onCommit} />);
    await userEvent.clear(field());
    await userEvent.type(field(), "9{Enter}");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(9);
    expect(field()).toHaveValue("0:05.5");
  });

  it("commits nothing when nothing was typed or the typing was dropped", async () => {
    // 2.04 shows as 0:02.0: passing through the field must not round the value.
    const onCommit = vi.fn();
    render(<ClockField label="Inizio" value={2.04} onCommit={onCommit} />);
    await userEvent.click(field());
    await userEvent.keyboard("{Enter}");
    await userEvent.type(field(), "7{Escape}");
    expect(field()).toHaveValue("0:02.0");
    await userEvent.tab();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
