import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import { ShareDialog } from "./share-dialog";

const mock = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: mock.toast }));

const URL_OF_SONG = () => `${window.location.origin}/projects/p1?lang=it`;

function show(props: Partial<Parameters<typeof ShareDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  render(
    <LocaleProvider value="it">
      <ShareDialog
        open
        onOpenChange={onOpenChange}
        title="Notte & città"
        href="/projects/p1?lang=it"
        {...props}
      />
    </LocaleProvider>,
  );
  return { onOpenChange };
}
const dialog = () => screen.getByRole("dialog", { name: "Condividi" });

function setClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}
function setShare(share: unknown) {
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: share,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setShare(undefined);
});
afterEach(() => setShare(undefined));

describe("share window", () => {
  it("shows the song's absolute link and every network", () => {
    show();
    expect(within(dialog()).getByLabelText("Link alla canzone")).toHaveValue(
      URL_OF_SONG(),
    );
    for (const name of [
      "WhatsApp",
      "Telegram",
      "X",
      "Facebook",
      "LinkedIn",
      "Reddit",
      "Email",
    ])
      expect(within(dialog()).getByRole("link", { name })).toBeInTheDocument();
  });

  it("points each network at its share page, in a new tab, with the title and link encoded", () => {
    show();
    const u = encodeURIComponent(URL_OF_SONG());
    const t = encodeURIComponent("Notte & città");
    const link = (name: string) => within(dialog()).getByRole("link", { name });
    expect(link("WhatsApp")).toHaveAttribute(
      "href",
      `https://wa.me/?text=${encodeURIComponent(`Notte & città ${URL_OF_SONG()}`)}`,
    );
    expect(link("Telegram")).toHaveAttribute(
      "href",
      `https://t.me/share/url?url=${u}&text=${t}`,
    );
    expect(link("X")).toHaveAttribute(
      "href",
      `https://twitter.com/intent/tweet?url=${u}&text=${t}`,
    );
    expect(link("Facebook")).toHaveAttribute(
      "href",
      `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    );
    expect(link("LinkedIn")).toHaveAttribute(
      "href",
      `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    );
    expect(link("Reddit")).toHaveAttribute(
      "href",
      `https://www.reddit.com/submit?url=${u}&title=${t}`,
    );
    for (const name of [
      "WhatsApp",
      "Telegram",
      "X",
      "Facebook",
      "LinkedIn",
      "Reddit",
    ]) {
      expect(link(name)).toHaveAttribute("target", "_blank");
      expect(link(name)).toHaveAttribute("rel", "noopener noreferrer");
    }
    // The mail app opens in place.
    expect(link("Email").getAttribute("href")).toMatch(/^mailto:\?subject=/u);
    expect(link("Email")).not.toHaveAttribute("target");
  });

  it("copies the link and says so", async () => {
    const writeText = vi.fn(async () => {});
    setClipboard(writeText);
    show();
    await userEvent.click(
      within(dialog()).getByRole("button", { name: "Copia il link" }),
    );
    expect(writeText).toHaveBeenCalledWith(URL_OF_SONG());
    expect(mock.toast.success).toHaveBeenCalledWith("Link copiato");
    expect(
      within(dialog()).getByRole("button", { name: "Copiato" }),
    ).toBeInTheDocument();
  });

  it("tells the user when the clipboard refuses", async () => {
    setClipboard(async () => {
      throw new Error("denied");
    });
    show();
    await userEvent.click(
      within(dialog()).getByRole("button", { name: "Copia il link" }),
    );
    expect(mock.toast.error).toHaveBeenCalledWith(
      "Non riesco a copiare il link",
    );
    expect(mock.toast.success).not.toHaveBeenCalled();
  });

  it("offers the device's share sheet only when there is one", async () => {
    const { unmount } = render(
      <LocaleProvider value="it">
        <ShareDialog open onOpenChange={() => {}} title="Mare" href="/p" />
      </LocaleProvider>,
    );
    expect(
      screen.queryByRole("button", { name: "Condividi con altre app" }),
    ).toBeNull();
    unmount();

    const share = vi.fn(async () => {});
    setShare(share);
    show({ title: "Mare" });
    await userEvent.click(
      screen.getByRole("button", { name: "Condividi con altre app" }),
    );
    expect(share).toHaveBeenCalledWith({
      title: "Mare",
      url: URL_OF_SONG(),
    });
  });

  it("does not call a closed system sheet a failure, but reports a real one", async () => {
    const share = vi.fn(async () => {
      throw new DOMException("closed", "AbortError");
    });
    setShare(share);
    show();
    const button = screen.getByRole("button", {
      name: "Condividi con altre app",
    });
    await userEvent.click(button);
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(mock.toast.error).not.toHaveBeenCalled();

    share.mockRejectedValueOnce(new DOMException("nope", "NotAllowedError"));
    await userEvent.click(button);
    await waitFor(() => expect(mock.toast.error).toHaveBeenCalledTimes(1));
  });

  it("closes with its button and with Escape, and renders nothing while closed", async () => {
    const { onOpenChange } = show();
    await userEvent.click(
      within(dialog()).getByRole("button", { name: "Chiudi" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("is English when the interface is", () => {
    render(
      <LocaleProvider value="en">
        <ShareDialog open onOpenChange={() => {}} title="Sea" href="/p" />
      </LocaleProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Copy link" }),
    ).toBeInTheDocument();
  });
});
