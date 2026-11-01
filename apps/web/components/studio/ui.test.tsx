import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { EditableSlider, snapToStep } from "./ui";

function Harness(props: Partial<React.ComponentProps<typeof EditableSlider>>) {
  const [value, setValue] = useState(props.value ?? 50);
  return (
    <TooltipProvider>
      <EditableSlider
        label="Stranezza"
        min={0}
        max={100}
        {...props}
        value={value}
        display={props.display ?? `${value}%`}
        onChange={(next) => {
          setValue(next);
          props.onChange?.(next);
        }}
      />
    </TooltipProvider>
  );
}

const open = () =>
  userEvent.click(screen.getByRole("button", { name: /^Stranezza:/u }));
const field = () => screen.getByRole("textbox", { name: "Stranezza" });

describe("snapToStep", () => {
  it("clamps to the range and snaps to the step", () => {
    expect(snapToStep(103, 0, 100, 1)).toBe(100);
    expect(snapToStep(-4, 0, 100, 1)).toBe(0);
    expect(snapToStep(47, 10, 360, 5)).toBe(45);
    expect(snapToStep(7.3, 1, 15, 0.5)).toBe(7.5);
    expect(snapToStep(7.1, 1, 15, 0.5)).toBe(7);
  });
});

describe("EditableSlider", () => {
  it("shows the value and moves with the slider", async () => {
    render(<Harness />);
    expect(
      screen.getByRole("button", { name: "Stranezza: 50%" }),
    ).toBeVisible();
    const slider = screen.getByRole("slider", { name: "Stranezza" });
    fireEvent.change(slider, { target: { value: "51" } });
    expect(
      screen.getByRole("button", { name: "Stranezza: 51%" }),
    ).toBeVisible();
  });

  it("commits a typed value with Enter", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await open();
    await userEvent.clear(field());
    await userEvent.type(field(), "72{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(72);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Stranezza: 72%" }),
    ).toBeVisible();
  });

  it("cancels with Escape and keeps the old value", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await open();
    await userEvent.clear(field());
    await userEvent.type(field(), "9{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Stranezza: 50%" }),
    ).toBeVisible();
  });

  it("clamps a value that is out of range", async () => {
    render(<Harness />);
    await open();
    await userEvent.clear(field());
    await userEvent.type(field(), "400{Enter}");
    expect(
      screen.getByRole("button", { name: "Stranezza: 100%" }),
    ).toBeVisible();
    await open();
    await userEvent.clear(field());
    await userEvent.type(field(), "-7{Enter}");
    expect(screen.getByRole("button", { name: "Stranezza: 0%" })).toBeVisible();
  });

  it("keeps the old value when the text is not a number", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await open();
    await userEvent.clear(field());
    await userEvent.type(field(), "abc{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Stranezza: 50%" }),
    ).toBeVisible();
  });

  it("accepts a decimal comma and snaps to the step", async () => {
    render(
      <Harness
        min={1}
        max={15}
        step={0.5}
        value={7}
        display="7"
        label="Stranezza"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Stranezza:/u }));
    await userEvent.clear(field());
    await userEvent.type(field(), "9,3{Enter}");
    expect(screen.getByRole("slider", { name: "Stranezza" })).toHaveValue(
      "9.5",
    );
  });

  it("commits when the field loses focus", async () => {
    render(<Harness />);
    await open();
    await userEvent.clear(field());
    await userEvent.type(field(), "33");
    await userEvent.tab();
    expect(
      screen.getByRole("button", { name: "Stranezza: 33%" }),
    ).toBeVisible();
  });

  it("reads Auto at the minimum, and typing the minimum gives Auto", async () => {
    render(
      <Harness
        label="Tempo"
        min={40}
        max={240}
        value={120}
        autoAtMin="Auto"
        display="120"
      />,
    );
    const button = () => screen.getByRole("button", { name: /^Tempo:/u });
    expect(button()).toHaveAccessibleName("Tempo: 120");
    await userEvent.click(button());
    const input = screen.getByRole("textbox", { name: "Tempo" });
    await userEvent.clear(input);
    await userEvent.type(input, "10{Enter}");
    expect(button()).toHaveAccessibleName("Tempo: Auto");
    expect(button()).toHaveTextContent("Auto");
  });

  it("uses a custom reader for values like 2:30", async () => {
    const seconds = (text: string) => {
      const [m, s] = text.split(":");
      return s === undefined ? Number(m) : Number(m) * 60 + Number(s);
    };
    const mmss = (v: number) =>
      `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
    render(
      <Harness
        label="Durata"
        min={10}
        max={360}
        step={5}
        value={180}
        parse={seconds}
        format={mmss}
        display="3:00"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Durata:/u }));
    const input = screen.getByRole("textbox", { name: "Durata" });
    expect(input).toHaveValue("3:00");
    await userEvent.clear(input);
    await userEvent.type(input, "2:30{Enter}");
    expect(screen.getByRole("slider", { name: "Durata" })).toHaveValue("150");
  });
});
