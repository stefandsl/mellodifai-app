import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { STOCK_BACKGROUNDS, UPLOADS_BUCKET } from "@mellodifai/shared";
import { createClient } from "@supabase/supabase-js";
import { loadSecrets } from "../src/secrets.js";

// Uploads the Video Studio's royalty-free "Casuale" backgrounds (drawn by
// packages/visualizer/scripts/stock-backgrounds.mjs) to uploads/stock/visualizer/. Run once per
// Supabase project: node node_modules/tsx/dist/cli.mjs scripts/visualizer-stock.ts
const SOURCE = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "packages",
  "visualizer",
  "stock",
);

async function main() {
  const secrets = await loadSecrets();
  const url = secrets.values.SUPABASE_URL;
  const key = secrets.values.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const client = createClient(url, key);
  for (const path of STOCK_BACKGROUNDS) {
    const name = path.split("/").at(-1) as string;
    const { error } = await client.storage
      .from(UPLOADS_BUCKET)
      .upload(path, await readFile(join(SOURCE, name)), {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (error) throw new Error(`${path}: ${error.message}`);
    console.log(`uploaded ${path}`);
  }
}

await main();
