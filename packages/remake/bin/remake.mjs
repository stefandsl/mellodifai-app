#!/usr/bin/env node
// Runs the TypeScript CLI without a build step (tsx loader).
import { register } from "tsx/esm/api";

register();
await import("../src/cli.ts");
