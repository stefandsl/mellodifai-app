// Shared draft handoff between the public home hero composer and studio /create.
// Uses localStorage with a timestamp so drafts survive magic-link sign-in in a new tab,
// expire after 30 minutes, stay completely out of URLs/logs/emails, and share PROMPT_MAX_LENGTH.
import { PROMPT_MAX_LENGTH } from "@mellodifai/shared/prompt-limits";

export const COMPOSER_DRAFT_KEY = "mellodifai:composer-draft";
export const COMPOSER_PROMPT_MAX_LENGTH = PROMPT_MAX_LENGTH;
export const COMPOSER_DRAFT_MAX_AGE_MS = 30 * 60 * 1000;

export type StoredComposerDraft = {
  text: string;
  savedAt: number;
};

export function clampComposerPrompt(raw: string): string {
  return raw.trim().slice(0, PROMPT_MAX_LENGTH);
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function clearComposerDraft(
  storage: Storage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(COMPOSER_DRAFT_KEY);
  } catch {
    // Storage can be blocked in private browsing modes.
  }
}

export function saveComposerDraft(
  raw: string,
  storage: Storage | null = defaultStorage(),
  now: number = Date.now(),
): string {
  const clamped = clampComposerPrompt(raw);
  if (!storage) return clamped;
  try {
    if (clamped) {
      const payload: StoredComposerDraft = { text: clamped, savedAt: now };
      storage.setItem(COMPOSER_DRAFT_KEY, JSON.stringify(payload));
    } else {
      storage.removeItem(COMPOSER_DRAFT_KEY);
    }
  } catch {
    // Storage can be blocked in private browsing modes.
  }
  return clamped;
}

export function consumeComposerDraft(
  storage: Storage | null = defaultStorage(),
  now: number = Date.now(),
): string | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(COMPOSER_DRAFT_KEY);
    if (raw !== null) {
      storage.removeItem(COMPOSER_DRAFT_KEY);
    }
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { text, savedAt } = parsed as Partial<StoredComposerDraft>;
  if (typeof text !== "string" || typeof savedAt !== "number") return null;
  if (!Number.isFinite(savedAt)) return null;
  if (now - savedAt > COMPOSER_DRAFT_MAX_AGE_MS || savedAt - now > 60_000) {
    return null;
  }
  const clamped = clampComposerPrompt(text);
  return clamped || null;
}

export function hasDraftQueryParam(search: string): boolean {
  return new URLSearchParams(search).get("draft") === "1";
}

export function stripDraftQueryParam(
  loc: Pick<Location, "pathname" | "search" | "hash">,
): string {
  const params = new URLSearchParams(loc.search);
  params.delete("draft");
  const qs = params.toString();
  return `${loc.pathname}${qs ? `?${qs}` : ""}${loc.hash}`;
}

export function buildComposerSignUpUrl(action: string, prompt: string): string {
  const hasDraft = clampComposerPrompt(prompt).length > 0;
  const base = action || "/login";
  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1";
  const url = new URL(base, origin);
  url.searchParams.delete("prompt");
  url.searchParams.set("next", hasDraft ? "/create?draft=1" : "/create");
  return `${url.pathname}${url.search}`;
}
