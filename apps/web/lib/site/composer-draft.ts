// Shared draft handoff between the public home hero composer and studio /create.
// Uses localStorage so drafts survive magic-link sign-in opening in a new tab,
// keeps prompt text completely out of URLs/logs/emails, and shares the 500-char limit.

export const COMPOSER_DRAFT_KEY = "mellodifai:composer-draft";
export const COMPOSER_PROMPT_MAX_LENGTH = 500;

export function clampComposerPrompt(raw: string): string {
  return raw.trim().slice(0, COMPOSER_PROMPT_MAX_LENGTH);
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function saveComposerDraft(
  raw: string,
  storage: Storage | null = defaultStorage(),
): string {
  const clamped = clampComposerPrompt(raw);
  if (!storage) return clamped;
  try {
    if (clamped) {
      storage.setItem(COMPOSER_DRAFT_KEY, clamped);
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
  const clamped = clampComposerPrompt(raw);
  return clamped || null;
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
