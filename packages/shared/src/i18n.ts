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
  | "status.failed"
  | "auth.email"
  | "auth.sendLink"
  | "auth.sent"
  | "auth.notAllowed"
  | "project.create"
  | "project.topic"
  | "project.brief"
  | "project.languages"
  | "project.style"
  | "project.mood"
  | "project.vocalGender"
  | "project.balance"
  | "project.credits"
  | "action.approve"
  | "action.confirm"
  | "action.cancel"
  | "action.generateAgain"
  | "action.pick"
  | "action.uploadPrivate"
  | "action.rerender"
  | "worker.online"
  | "worker.offline"
  | "worker.busy"
  | "project.empty"
  | "lyrics.title"
  | "lyrics.text"
  | "publish.title"
  | "publish.description"
  | "publish.tags"
  | "publish.chapters";

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
    "auth.email": "Indirizzo email",
    "auth.sendLink": "Invia link di accesso",
    "auth.sent": "Controlla la tua casella email per il link di accesso.",
    "auth.notAllowed": "Questo indirizzo non e' abilitato.",
    "project.create": "Crea progetto",
    "project.topic": "Argomento",
    "project.brief": "Brief",
    "project.languages": "Lingue",
    "project.style": "Stile",
    "project.mood": "Atmosfera",
    "project.vocalGender": "Voce",
    "project.balance": "Saldo kie",
    "project.credits": "12 crediti kie per lingua",
    "action.approve": "Approva",
    "action.confirm": "Conferma",
    "action.cancel": "Annulla",
    "action.generateAgain": "Genera di nuovo (12 crediti)",
    "action.pick": "Scegli",
    "action.uploadPrivate": "Carica come privato",
    "action.rerender": "Rigenera video",
    "worker.online": "Online",
    "worker.offline": "Offline",
    "worker.busy": "Occupato",
    "project.empty": "Non ci sono ancora progetti.",
    "lyrics.title": "Titolo",
    "lyrics.text": "Testo",
    "publish.title": "Titolo video",
    "publish.description": "Descrizione",
    "publish.tags": "Tag",
    "publish.chapters": "Capitoli",
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
    "auth.email": "Email address",
    "auth.sendLink": "Send sign-in link",
    "auth.sent": "Check your email for the sign-in link.",
    "auth.notAllowed": "This address is not enabled.",
    "project.create": "Create project",
    "project.topic": "Topic",
    "project.brief": "Brief",
    "project.languages": "Languages",
    "project.style": "Style",
    "project.mood": "Mood",
    "project.vocalGender": "Voice",
    "project.balance": "kie balance",
    "project.credits": "12 kie credits per language",
    "action.approve": "Approve",
    "action.confirm": "Confirm",
    "action.cancel": "Cancel",
    "action.generateAgain": "Generate again (12 credits)",
    "action.pick": "Pick",
    "action.uploadPrivate": "Upload private",
    "action.rerender": "Re-render video",
    "worker.online": "Online",
    "worker.offline": "Offline",
    "worker.busy": "Busy",
    "project.empty": "There are no projects yet.",
    "lyrics.title": "Title",
    "lyrics.text": "Lyrics",
    "publish.title": "Video title",
    "publish.description": "Description",
    "publish.tags": "Tags",
    "publish.chapters": "Chapters",
  },
};

export function t(lang: "it" | "en", key: DictKey): string {
  return DICTIONARY[lang][key];
}
