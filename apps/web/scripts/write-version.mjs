import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

let version = "dev";
try {
  version = execFileSync("git", ["describe", "--tags"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  // Source archives and untagged checkouts have no deployed tag.
}
writeFileSync(".next/mdf-version", `${version}\n`);
