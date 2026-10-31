export type DictKey =
  | "app.name"
  | "nav.library"
  | "nav.newProject"
  | "status.drafting"
  | "status.lyrics_review"
  | "status.song_queued"
  | "status.takes_review"
  | "status.producing"
  | "status.video_review"
  | "status.approved"
  | "status.publishing"
  | "status.published"
  | "status.failed";

export const DICTIONARY: Record<"it" | "en", Record<DictKey, string>> = {
  it: {
    "app.name": "MellodifAI",
    "nav.library": "Libreria",
    "nav.newProject": "Nuovo progetto",
    "status.drafting": "Bozza testi",
    "status.lyrics_review": "Revisione testi",
    "status.song_queued": "Canzone in coda",
    "status.takes_review": "Revisione take",
    "status.producing": "Produzione",
    "status.video_review": "Revisione video",
    "status.approved": "Approvato",
    "status.publishing": "Pubblicazione",
    "status.published": "Pubblicato",
    "status.failed": "Non riuscito",
  },
  en: {
    "app.name": "MellodifAI",
    "nav.library": "Library",
    "nav.newProject": "New project",
    "status.drafting": "Drafting lyrics",
    "status.lyrics_review": "Lyrics review",
    "status.song_queued": "Song queued",
    "status.takes_review": "Takes review",
    "status.producing": "Producing",
    "status.video_review": "Video review",
    "status.approved": "Approved",
    "status.publishing": "Publishing",
    "status.published": "Published",
    "status.failed": "Failed",
  },
};

export function t(lang: "it" | "en", key: DictKey): string {
  return DICTIONARY[lang][key];
}
