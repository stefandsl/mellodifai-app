import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { WorkerBadge } from "./worker-badge";

it("renders offline when the worker heartbeat is older than 45 seconds", () => {
  render(
    <WorkerBadge
      lastSeen="2026-10-31T10:00:00.000Z"
      now={new Date("2026-10-31T10:00:46.000Z").getTime()}
    />,
  );
  expect(screen.getByText(/offline/i)).toBeInTheDocument();
});
