import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Storage {
  upload(path: string, localFile: string, contentType: string): Promise<void>;
}
export class SupabaseStorage implements Storage {
  constructor(private readonly client: SupabaseClient) {}
  async upload(
    path: string,
    localFile: string,
    contentType: string,
  ): Promise<void> {
    const { error } = await this.client.storage
      .from("previews")
      .upload(path, await readFile(localFile), { contentType, upsert: true });
    if (error) throw new Error(error.message);
  }
}
export const noStorage: Storage = { upload: async () => {} };
