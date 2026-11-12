import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// `pnpm -r test` runs every package's suite at once: under that load a dialog or a decoded
// waveform can take more than the default second to appear (the audio editor tests failed that
// way, a different one each run, while they passed alone). findBy and waitFor wait up to 5 s.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());
