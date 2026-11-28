// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CookieCreateSongInput, PROMPT_MAX_LENGTH } from "@mellodifai/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { safeNext } from "@/lib/redirect-url";
import { LIMITS } from "@/store/create-form";
import {
  buildComposerSignUpUrl,
  COMPOSER_DRAFT_KEY,
  COMPOSER_DRAFT_MAX_AGE_MS,
  COMPOSER_PROMPT_MAX_LENGTH,
  clampComposerPrompt,
  clearComposerDraft,
  consumeComposerDraft,
  hasDraftQueryParam,
  saveComposerDraft,
  stripDraftQueryParam,
} from "./composer-draft";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

describe("composer draft handoff", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("shares one PROMPT_MAX_LENGTH constant from @mellodifai/shared across composer, store, and API without extra 500 literals", () => {
    expect(PROMPT_MAX_LENGTH).toBe(500);
    expect(COMPOSER_PROMPT_MAX_LENGTH).toBe(PROMPT_MAX_LENGTH);
    expect(LIMITS.prompt).toBe(PROMPT_MAX_LENGTH);

    const baseInput = {
      mode: "simple" as const,
      lyrics: "",
      styles: "",
      languages: ["en" as const],
      vocalGender: null,
      settings: {},
    };
    expect(
      CookieCreateSongInput.safeParse({
        ...baseInput,
        prompt: "a".repeat(PROMPT_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      CookieCreateSongInput.safeParse({
        ...baseInput,
        prompt: "a".repeat(PROMPT_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);

    // None of the four consumers hardcode a 500 literal for the prompt limit.
    for (const rel of [
      "packages/shared/src/ops/inputs.ts",
      "apps/web/store/create-form.ts",
      "apps/web/lib/site/composer-draft.ts",
      "apps/web/components/site/hero-composer.tsx",
    ]) {
      const src = readFileSync(resolve(REPO_ROOT, rel), "utf8");
      expect(src, `${rel} should import PROMPT_MAX_LENGTH`).not.toMatch(
        /\b500\b/u,
      );
    }
  });

  it("saves with a timestamp, reads, and clears a multi-line draft in localStorage", () => {
    const now = 1_700_000_000_000;
    const multiLine = "First line of the chorus\nSecond line keeps the rhyme";
    const saved = saveComposerDraft(`  ${multiLine}  `, undefined, now);
    expect(saved).toBe(multiLine);

    const raw = window.localStorage.getItem(COMPOSER_DRAFT_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({
      text: multiLine,
      savedAt: now,
    });
    expect(window.sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();

    const consumed = consumeComposerDraft(undefined, now + 60_000);
    expect(consumed).toBe(multiLine);
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
    expect(consumeComposerDraft(undefined, now + 60_000)).toBeNull();
  });

  it("drops drafts older than 30 minutes and clears storage", () => {
    const savedAt = 1_700_000_000_000;
    saveComposerDraft(
      "Stale prompt from an earlier visitor",
      undefined,
      savedAt,
    );

    expect(
      consumeComposerDraft(undefined, savedAt + COMPOSER_DRAFT_MAX_AGE_MS + 1),
    ).toBeNull();
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();

    // A draft right at the 30-minute boundary is still valid.
    saveComposerDraft("Fresh enough prompt", undefined, savedAt);
    expect(
      consumeComposerDraft(undefined, savedAt + COMPOSER_DRAFT_MAX_AGE_MS),
    ).toBe("Fresh enough prompt");

    // Future clock skew over 60 s is dropped; within 59 s is accepted.
    saveComposerDraft("Future skew rejected", undefined, savedAt + 61_000);
    expect(consumeComposerDraft(undefined, savedAt)).toBeNull();
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();

    saveComposerDraft("Future skew allowed", undefined, savedAt + 59_000);
    expect(consumeComposerDraft(undefined, savedAt)).toBe(
      "Future skew allowed",
    );
  });

  it("removes the draft key when clearComposerDraft is called (sign-out)", () => {
    saveComposerDraft("Draft to wipe on sign-out");
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).not.toBeNull();
    clearComposerDraft();
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
  });

  it("clamps drafts over the limit on both save and read", () => {
    const now = 1_700_000_000_000;
    const longPrompt = `${"a".repeat(495)}\n${"b".repeat(40)}`;
    const clamped = clampComposerPrompt(longPrompt);
    expect(clamped.length).toBe(PROMPT_MAX_LENGTH);
    expect(clamped.includes("\n")).toBe(true);

    const saved = saveComposerDraft(longPrompt, undefined, now);
    expect(saved.length).toBe(PROMPT_MAX_LENGTH);
    const parsed = JSON.parse(
      window.localStorage.getItem(COMPOSER_DRAFT_KEY) ?? "{}",
    ) as { text?: string };
    expect(parsed.text?.length).toBe(PROMPT_MAX_LENGTH);

    window.localStorage.setItem(
      COMPOSER_DRAFT_KEY,
      JSON.stringify({ text: longPrompt, savedAt: now }),
    );
    expect(consumeComposerDraft(undefined, now)?.length).toBe(
      PROMPT_MAX_LENGTH,
    );
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
  });

  it("clears any stale draft when saving empty whitespace", () => {
    saveComposerDraft("Previous draft");
    expect(saveComposerDraft("   \n  ")).toBe("");
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
  });

  it("detects and strips only draft=1 from query strings", () => {
    expect(hasDraftQueryParam("?draft=1")).toBe(true);
    expect(hasDraftQueryParam("?foo=bar&draft=1")).toBe(true);
    expect(hasDraftQueryParam("?draft=0")).toBe(false);
    expect(hasDraftQueryParam("")).toBe(false);

    expect(
      stripDraftQueryParam({
        pathname: "/create",
        search: "?draft=1",
        hash: "",
      }),
    ).toBe("/create");
    expect(
      stripDraftQueryParam({
        pathname: "/create",
        search: "?tab=songs&draft=1",
        hash: "#top",
      }),
    ).toBe("/create?tab=songs#top");
  });

  it("builds a sign-in URL with next=/create?draft=1 and never puts prompt text in the URL", () => {
    const secretText = "Line one secret\nLine two secret";
    const url = buildComposerSignUpUrl("/login", secretText);
    expect(url).toBe("/login?next=%2Fcreate%3Fdraft%3D1");
    expect(url).not.toContain("secret");
    expect(url).not.toContain("prompt=");

    const parsed = new URL(url, "http://127.0.0.1");
    expect(parsed.searchParams.get("prompt")).toBeNull();
    const next = parsed.searchParams.get("next") ?? "";
    expect(next).toBe("/create?draft=1");
    expect(safeNext(next, false)).toBe("/create?draft=1");

    expect(buildComposerSignUpUrl("/login", "   ")).toBe(
      "/login?next=%2Fcreate",
    );
  });
});
