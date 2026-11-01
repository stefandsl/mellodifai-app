import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useWorkerState, WorkerProvider } from "./worker-state";

vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    from: () => {
      // The refresh after mount never resolves here: only the first render is under test.
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => new Promise(() => {}),
      };
      return chain;
    },
  }),
}));

afterEach(() => vi.useRealTimers());

function Status() {
  const worker = useWorkerState();
  return <p>{worker.online ? "online" : "offline"}</p>;
}

it("judges the first render with the server's clock, so it hydrates like the server drew it", () => {
  const renderedAt = Date.parse("2026-11-01T10:00:00Z");
  // The browser hydrates a minute after the server rendered: with the browser clock the
  // worker would look offline and the markup would not match.
  vi.useFakeTimers({ now: renderedAt + 60_000 });
  render(
    <WorkerProvider
      isAdmin
      initial={{
        id: "pc",
        lastSeen: new Date(renderedAt - 10_000).toISOString(),
        balance: 87,
        engines: {},
        renderedAt,
      }}
    >
      <Status />
    </WorkerProvider>,
  );
  expect(screen.getByText("online")).toBeInTheDocument();
});
