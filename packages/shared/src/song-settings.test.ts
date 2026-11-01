import { describe, expect, it } from "vitest";
import { SongSettingsSchema } from "./song-settings.js";

describe("SongSettingsSchema.engine", () => {
  it("defaults to kie so projects created before local engines keep working", () => {
    expect(SongSettingsSchema.parse({}).engine).toBe("kie");
  });
  it("keeps the local engines and rejects unknown ones", () => {
    expect(SongSettingsSchema.parse({ engine: "yue2" }).engine).toBe("yue2");
    expect(SongSettingsSchema.parse({ engine: "ace-step" }).engine).toBe(
      "ace-step",
    );
    expect(SongSettingsSchema.safeParse({ engine: "suno" }).success).toBe(
      false,
    );
  });
});
