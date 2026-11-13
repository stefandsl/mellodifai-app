import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { nativeLayout } from "../../lib/native/layout.js";
import {
  type StorageRow,
  storageFileLayout,
  storageObjectPath,
} from "../../lib/native/storage-metadata.js";
import { removeAttributeSync } from "../../native/storage/fs-xattr/index.js";
import { runStack } from "../../stack.js";

// Explicitly opt in on the one authorized lab root. No production fallback.
const enabled =
  process.env.MDF_NATIVE_INTEGRATION === "1" &&
  resolve(process.env.MELLODIFAI_ROOT ?? ".") ===
    resolve("E:/mellodifai/native-lab") &&
  process.env.SUPABASE_URL === "http://127.0.0.1:45621" &&
  Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.SUPABASE_ANON_KEY &&
      process.env.TEST_DB_URL,
  );

it.skipIf(!enabled)(
  "Storage preserves bytes, headers, RLS and metadata through the gateway and a native restart",
  async (context) => {
    const url = process.env.SUPABASE_URL as string;
    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return context.skip();
    } catch {
      return context.skip();
    }
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
    const anon = process.env.SUPABASE_ANON_KEY as string;
    const options = {
      auth: { persistSession: false, autoRefreshToken: false },
    };
    const service = createClient(url, key, options);
    const user = createClient(url, anon, options);
    const suffix = randomUUID();
    const bucket = `native-run1-${suffix}`;
    const email = `${bucket}@example.test`;
    const password = `fixture-${randomUUID()}`;
    let owner: string | undefined;
    let preview: string | undefined;
    let createdBucket = false;
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    const small = Buffer.from("native Storage metadata and byte persistence\n");
    const large = new Uint8Array(17 * 1024 * 1024 + 13).fill(71);
    const objectUrl = (name: string) =>
      `${url}/storage/v1/object/${bucket}/${name}`;
    const download = async (
      name: string,
      expected: Uint8Array,
      type: string,
    ) => {
      const response = await fetch(objectUrl(name), {
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(type);
      expect(response.headers.get("cache-control")).toBe("max-age=1234");
      expect(
        Buffer.from(await response.arrayBuffer()).equals(Buffer.from(expected)),
      ).toBe(true);
    };
    try {
      expect(
        (await service.storage.createBucket(bucket, { public: false })).error,
      ).toBeNull();
      createdBucket = true;
      for (const [name, data, contentType] of [
        ["small.mp3", small, "audio/mpeg"],
        ["large.bin", large, "application/octet-stream"],
      ] as const)
        expect(
          (
            await service.storage
              .from(bucket)
              .upload(name, data, { contentType, cacheControl: "1234" })
          ).error,
        ).toBeNull();
      await download("small.mp3", small, "audio/mpeg");
      await download("large.bin", large, "application/octet-stream");
      // A copied object loses its streams. Exercise the actual CLI against
      // this fixture's database row and physical file, then download again.
      const sql = postgres(process.env.TEST_DB_URL as string, { max: 1 });
      let stored: StorageRow;
      try {
        const rows =
          await sql`select bucket_id, name, version, metadata from storage.objects where bucket_id = ${bucket} and name = 'small.mp3'`;
        expect(rows).toHaveLength(1);
        stored = rows[0] as unknown as StorageRow;
      } finally {
        await sql.end();
      }
      const source = parse(
        readFileSync(
          new URL("../../compose/base.yml", import.meta.url),
          "utf8",
        ),
      );
      const files = storageFileLayout(
        nativeLayout("e2e").objects,
        source.services.storage.environment,
      );
      const physical = storageObjectPath(files, stored);
      removeAttributeSync(physical, "user.supabase.content-type");
      removeAttributeSync(physical, "user.supabase.cache-control");
      const metadata = (mode: string) =>
        spawnSync(
          process.execPath,
          [
            "--import",
            pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
            fileURLToPath(
              new URL("../../storage-metadata.ts", import.meta.url),
            ),
            "--env",
            "e2e",
            mode,
          ],
          { encoding: "utf8", windowsHide: true, timeout: 30_000 },
        );
      const check = metadata("--check");
      expect(check.status).toBe(1);
      expect(JSON.parse(check.stdout).attributeMismatches).toHaveLength(2);
      const repaired = metadata("--apply");
      expect(repaired.status).toBe(0);
      expect(JSON.parse(repaired.stdout).updated).toBe(2);
      expect(metadata("--check").status).toBe(0);
      await download("small.mp3", small, "audio/mpeg");
      const range = await fetch(objectUrl("large.bin"), {
        headers: { ...headers, Range: "bytes=4-19" },
      });
      expect(range.status).toBe(206);
      expect(range.headers.get("content-range")).toBe(
        `bytes 4-19/${large.length}`,
      );
      expect(Buffer.from(await range.arrayBuffer())).toEqual(
        Buffer.from(large.subarray(4, 20)),
      );
      const signed = await service.storage
        .from(bucket)
        .createSignedUrl("small.mp3", 300);
      expect(signed.error).toBeNull();
      if (!signed.data) throw new Error("Missing signed URL");
      const publicReply = await fetch(signed.data.signedUrl);
      expect(publicReply.status).toBe(200);
      expect(Buffer.from(await publicReply.arrayBuffer())).toEqual(small);
      expect(
        (await service.storage.from(bucket).copy("small.mp3", "copy.mp3"))
          .error,
      ).toBeNull();
      await download("copy.mp3", small, "audio/mpeg");
      expect(
        (await service.storage.from(bucket).move("copy.mp3", "moved.mp3"))
          .error,
      ).toBeNull();
      await download("moved.mp3", small, "audio/mpeg");
      const listing = await service.storage.from(bucket).list();
      expect(listing.error).toBeNull();
      expect(listing.data?.map((item) => item.name).sort()).toEqual([
        "large.bin",
        "moved.mp3",
        "small.mp3",
      ]);
      expect(
        (await service.storage.from(bucket).remove(["moved.mp3"])).error,
      ).toBeNull();
      expect((await fetch(objectUrl("moved.mp3"), { headers })).ok).toBe(false);

      // Use the application's reviewed preview RLS: customer owns the second
      // path segment, while uploads and bucket administration stay service-only.
      expect(
        (await service.from("admin_allowlist").insert({ email, role: "admin" }))
          .error,
      ).toBeNull();
      const created = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      owner = created.data.user?.id;
      if (!owner) throw new Error("Missing fixture user");
      expect(
        (
          await service
            .from("profiles")
            .update({ role: "customer" })
            .eq("id", owner)
        ).error,
      ).toBeNull();
      expect(
        (await user.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      preview = `previews/${owner}/${suffix}/it/preview.mp3`;
      expect(
        (
          await service.storage
            .from("previews")
            .upload(preview, small, { contentType: "audio/mpeg" })
        ).error,
      ).toBeNull();
      expect(
        (await user.storage.from("previews").createSignedUrl(preview, 60))
          .error,
      ).toBeNull();
      expect(
        (await user.storage.from(bucket).createSignedUrl("small.mp3", 60))
          .error,
      ).not.toBeNull();
      expect(
        (await user.storage.from(bucket).upload("forbidden.mp3", small)).error,
      ).not.toBeNull();

      await runStack("stop", "e2e", { runtime: "native" });
      await runStack("start", "e2e", { runtime: "native" });
      await download("small.mp3", small, "audio/mpeg");
      await download("large.bin", large, "application/octet-stream");
      expect(
        (await user.storage.from("previews").createSignedUrl(preview, 60))
          .error,
      ).toBeNull();
    } finally {
      if (preview) await service.storage.from("previews").remove([preview]);
      if (owner) await service.auth.admin.deleteUser(owner);
      await service.from("admin_allowlist").delete().eq("email", email);
      if (createdBucket) {
        await service.storage
          .from(bucket)
          .remove([
            "small.mp3",
            "large.bin",
            "copy.mp3",
            "moved.mp3",
            "forbidden.mp3",
          ]);
        await service.storage.deleteBucket(bucket);
      }
    }
  },
);
