// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { safeNext } from "@/lib/redirect-url";
import { LIMITS } from "@/store/create-form";
import {
  buildComposerSignUpUrl,
  COMPOSER_DRAFT_KEY,
  COMPOSER_PROMPT_MAX_LENGTH,
  clampComposerPrompt,
  consumeComposerDraft,
  saveComposerDraft,
} from "./composer-draft";

describe("composer draft handoff", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("shares the same 500-character limit with studio create-form", () => {
    expect(COMPOSER_PROMPT_MAX_LENGTH).toBe(500);
    expect(LIMITS.prompt).toBe(COMPOSER_PROMPT_MAX_LENGTH);
  });

  it("saves, reads, and clears a multi-line draft in localStorage", () => {
    const multiLine = "First line of the chorus\nSecond line keeps the rhyme";
    const saved = saveComposerDraft(`  ${multiLine}  `);
    expect(saved).toBe(multiLine);
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).toBe(multiLine);
    expect(window.sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();

    const consumed = consumeComposerDraft();
    expect(consumed).toBe(multiLine);
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
    expect(consumeComposerDraft()).toBeNull();
  });

  it("clamps drafts over the limit on both save and read", () => {
    const longPrompt = `${"a".repeat(495)}\n${"b".repeat(40)}`;
    const clamped = clampComposerPrompt(longPrompt);
    expect(clamped.length).toBe(COMPOSER_PROMPT_MAX_LENGTH);
    expect(clamped.includes("\n")).toBe(true);

    const saved = saveComposerDraft(longPrompt);
    expect(saved.length).toBe(COMPOSER_PROMPT_MAX_LENGTH);
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)?.length).toBe(
      COMPOSER_PROMPT_MAX_LENGTH,
    );

    window.localStorage.setItem(COMPOSER_DRAFT_KEY, longPrompt);
    expect(consumeComposerDraft()?.length).toBe(COMPOSER_PROMPT_MAX_LENGTH);
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
  });

  it("clears any stale draft when saving empty whitespace", () => {
    saveComposerDraft("Previous draft");
    expect(saveComposerDraft("   \n  ")).toBe("");
    expect(window.localStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
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
