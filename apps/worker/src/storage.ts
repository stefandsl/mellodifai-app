import { readFile, stat, writeFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Storage {
  upload(path: string, localFile: string, contentType: string): Promise<void>;
  remove?(paths: string[]): Promise<void>;
  // Copies a stored file to a local path (an edited take only exists in storage). `bucket` is
  // "previews" unless named: the studio's uploads live in "uploads".
  download?(path: string, localFile: string, bucket?: string): Promise<void>;
}
export class SupabaseStorage implements Storage {
  constructor(private readonly client: SupabaseClient) {}
  async upload(
    path: string,
    localFile: string,
    contentType: string,
  ): Promise<void> {
    const incoming = (await stat(localFile)).size;
    let total = 0;
    let replaced = 0;
    const walk = async (prefix = ""): Promise<void> => {
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await this.client.storage
          .from("previews")
          .list(prefix, {
            limit: 1000,
            offset,
            sortBy: { column: "name", order: "asc" },
          });
        if (error) throw new Error(error.message);
        for (const item of data ?? []) {
          if (item.id) {
            const bytes = Number(item.metadata?.size ?? 0);
            if (!Number.isFinite(bytes) || bytes < 0)
              throw new Error("Cannot determine storage size");
            total += bytes;
            if ((prefix ? `${prefix}/${item.name}` : item.name) === path)
              replaced = bytes;
          } else await walk(prefix ? `${prefix}/${item.name}` : item.name);
        }
        if ((data?.length ?? 0) < 1000) break;
      }
    };
    await walk();
    if (total - replaced + incoming > 900 * 1024 * 1024)
      throw new Error("storage almost full: delete old projects or upgrade");
    const { error } = await this.client.storage
      .from("previews")
      .upload(path, await readFile(localFile), { contentType, upsert: true });
    if (error) throw new Error(error.message);
  }
  async download(
    path: string,
    localFile: string,
    bucket = "previews",
  ): Promise<void> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .download(path);
    if (error || !data)
      throw new Error(error?.message ?? `Cannot download ${path}`);
    await writeFile(localFile, Buffer.from(await data.arrayBuffer()));
  }
  async remove(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const { error } = await this.client.storage.from("previews").remove(paths);
    if (error) throw new Error(error.message);
  }
}
export const noStorage: Storage = { upload: async () => {} };
