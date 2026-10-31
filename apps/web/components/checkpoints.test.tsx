import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LyricEditor } from "./lyric-editor";
import { PublishConfirmDialog } from "./publish-confirm-dialog";
import { TakePicker } from "./take-picker";

const invalidPack = {
  title: "",
  lyrics: "[Verse]\nOnly one line",
  style: "Synth pop",
  exclude: "",
  settings: {
    model: "V6",
    vocalGender: "f",
    styleWeight: 0.7,
    weirdness: 0.35,
    variety: 1,
    duration: 310,
  },
  displayMap: {},
  l10n: {},
} as const;

describe("checkpoint components", () => {
  it("shows lyric validation errors inline and disables approval until valid", async () => {
    render(<LyricEditor pack={invalidPack} theme="vbp" onApprove={vi.fn()} />);

    expect(screen.getByText(/Controlla i campi/i)).toBeInTheDocument();
    expect(screen.getByText(/80 righe cantate/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approva/i })).toBeDisabled();
  });

  it("requires confirmation before generating another take", async () => {
    const onGenerateAgain = vi.fn();
    const user = userEvent.setup();
    render(
      <TakePicker
        takes={[]}
        onPick={vi.fn()}
        onGenerateAgain={onGenerateAgain}
      />,
    );

    await user.click(screen.getByRole("button", { name: /genera di nuovo/i }));
    expect(screen.getByText(/conferma nuova generazione/i)).toBeInTheDocument();
    expect(onGenerateAgain).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^conferma$/i }));
    expect(onGenerateAgain).toHaveBeenCalledOnce();
  });

  it("names the video and privacy before publishing visibility", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <PublishConfirmDialog
        videoName="Va bene, passa"
        privacy="unlisted"
        onConfirm={onConfirm}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /rendi non in elenco/i }),
    );
    expect(screen.getByText(/Va bene, passa/)).toBeInTheDocument();
    expect(screen.getAllByText(/non in elenco/i).length).toBeGreaterThan(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^conferma$/i }));
    expect(onConfirm).toHaveBeenCalledWith("unlisted");
  });
});
