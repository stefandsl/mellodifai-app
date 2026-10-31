import { describe, expect, it } from "vitest";

import {
  CreateProjectInput,
  SetPrivacyInput,
  UpdateLyricsInput,
} from "./schemas";

describe("web action schemas", () => {
  it("rejects an invalid new project", () => {
    expect(
      CreateProjectInput.safeParse({ topic: "", languages: ["xx"] }).success,
    ).toBe(false);
  });

  it("rejects unsafe action inputs", () => {
    expect(
      UpdateLyricsInput.safeParse({ versionId: "not-a-uuid", pack: {} })
        .success,
    ).toBe(false);
    expect(
      SetPrivacyInput.safeParse({
        publicationId: "not-a-uuid",
        privacy: "friends",
      }).success,
    ).toBe(false);
  });
});
