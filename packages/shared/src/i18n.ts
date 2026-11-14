export type DictKey =
  | "action.backToLyrics"
  | "action.retryKieFree"
  | "publish.quotaWait"
  | "publish.privacy"
  | "visibility.private"
  | "visibility.public"
  | "visibility.unlisted"
  | "visibility.scheduled"
  | "media.youtube"
  | "resolve.kieId"
  | "resolve.videoId"
  | "resolve.notCharged"
  | "resolve.notUploaded"
  | "resolve.charged"
  | "resolve.uploaded"
  | "pipeline.imported"
  | "media.master"
  | "media.hook"
  | "media.thumbnail"
  | "media.unavailable"
  | "app.description"
  | "value.unknown"
  | "qa.integrated_loudness"
  | "qa.true_peak"
  | "qa.crushed_words"
  | "qa.duration"
  | "qa.notMeasured"
  | "publish.tag"
  | "app.name"
  | "nav.library"
  | "nav.newProject"
  | "status.analysing"
  | "status.drafting"
  | "status.lyrics_review"
  | "status.song_queued"
  | "status.takes_review"
  | "status.audio_ready"
  | "status.producing"
  | "status.video_review"
  | "status.approved"
  | "status.publishing"
  | "status.published"
  | "status.failed"
  | "auth.email"
  | "auth.code"
  | "auth.verifyCode"
  | "auth.sendLink"
  | "auth.sent"
  | "auth.unavailable"
  | "auth.rateLimited"
  | "action.approveGeneration"
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
  | "action.newRender"
  | "worker.online"
  | "worker.offline"
  | "worker.busy"
  | "project.empty"
  | "lyrics.title"
  | "lyrics.text"
  | "publish.title"
  | "publish.description"
  | "publish.tags"
  | "publish.chapters"
  | "error.action"
  | "error.unauthorized"
  | "error.forbidden_scope"
  | "error.not_found"
  | "error.conflict"
  | "error.idempotency_mismatch"
  | "error.in_progress"
  | "error.ambiguous_spend"
  | "error.validation"
  | "error.cap_exceeded"
  | "error.rate_limited"
  | "error.internal"
  | "auth.invalidLink"
  | "auth.invalidCode"
  | "auth.devInbox"
  | "job.superseded"
  | "error.details"
  | "lyrics.advanced"
  | "library.title"
  | "library.updated"
  | "project.heading"
  | "project.subtitle"
  | "project.label"
  | "project.theme"
  | "voice.f"
  | "voice.m"
  | "dialog.generation"
  | "dialog.cost"
  | "dialog.visibility"
  | "privacy.public"
  | "privacy.unlisted"
  | "privacy.scheduled"
  | "privacy.private"
  | "publish.suffix"
  | "publish.credits"
  | "publish.at"
  | "publish.video"
  | "publish.wait"
  | "qa.pass"
  | "qa.fail"
  | "qa.override"
  | "qa.gate"
  | "qa.value"
  | "action.approveVideo"
  | "action.retry"
  | "panel.wait"
  | "panel.queued"
  | "panel.published"
  | "worker.since"
  | "worker.unknown"
  | "pipeline.title"
  | "take.label"
  | "lyrics.exclude"
  | "lyrics.settings"
  | "lyrics.displayMap"
  | "lyrics.l10n"
  | "validation.pack"
  | "validation.lines"
  | "validation.dash"
  | "validation.json"
  | "language.it"
  | "language.en"
  | "stage.draft_lyrics"
  | "stage.generate_song"
  | "stage.timing"
  | "stage.storyboard"
  | "stage.render_master"
  | "stage.render_hook"
  | "stage.qa"
  | "stage.art"
  | "stage.publish"
  | "stage.set_privacy"
  | "stage.import_legacy"
  | "stage.stems"
  | "stage.visualizer"
  | "stage.replace_section"
  | "stage.import_audio"
  | "stage.remake_ingest"
  | "stage.remake_analyse"
  | "stage.remake_rewrite"
  | "stage.lyrics_assist"
  | "stage.align_lyrics"
  | "stage.music_video_plan"
  | "job.queued"
  | "job.running"
  | "job.done"
  | "job.failed"
  | "job.cancelled";

export const DICTIONARY: Record<"it" | "en", Record<DictKey, string>> = {
  it: {
    "app.description": "La tua musica, dal testo al video.",
    "value.unknown": "Non disponibile",
    "qa.integrated_loudness": "Volume integrato",
    "qa.true_peak": "Picco reale",
    "qa.crushed_words": "Parole troppo brevi",
    "qa.duration": "Durata",
    "qa.notMeasured": "Non misurato",
    "publish.tag": "lyric video",
    "error.action": "Operazione non riuscita. Riprova.",
    "error.unauthorized": "Accedi per continuare.",
    "error.forbidden_scope": "Non hai il permesso per questa operazione.",
    "error.not_found": "Elemento non trovato.",
    "error.conflict": "L'elemento non è nello stato richiesto.",
    "error.idempotency_mismatch":
      "Questa chiave è già stata usata per una richiesta diversa.",
    "error.in_progress": "La richiesta è già in corso. Riprova tra poco.",
    "error.ambiguous_spend":
      "L'esito della spesa non è ancora noto. Controlla prima di riprovare.",
    "error.validation": "Controlla i dati inseriti.",
    "error.cap_exceeded": "Limite di spesa raggiunto.",
    "error.rate_limited": "Troppi tentativi. Riprova tra poco.",
    "error.internal": "Errore interno. Riprova.",
    "auth.invalidLink": "Link non valido o scaduto. Richiedi un nuovo link.",
    "auth.invalidCode":
      "Codice non valido o scaduto. Richiedi un nuovo codice.",
    "job.superseded": "Tentativo precedente non riuscito",
    "error.details": "Dettagli tecnici",
    "lyrics.advanced": "Impostazioni avanzate",
    "auth.devInbox":
      "Ambiente locale: le email non escono dal PC. Apri la casella di test per il link.",
    "library.title": "I tuoi progetti",
    "library.updated": "Aggiornato",
    "project.heading": "Crea una nuova canzone",
    "project.subtitle": "Tema VBP, dalla bozza al video.",
    "project.label": "Progetto",
    "project.theme": "Tema: VBP",
    "voice.f": "Femminile",
    "voice.m": "Maschile",
    "dialog.generation": "Conferma nuova generazione",
    "dialog.cost": "Questa azione costa 12 crediti kie per questa lingua.",
    "dialog.visibility": "Conferma visibilità",
    "privacy.public": "Rendi pubblico",
    "privacy.unlisted": "Rendi non in elenco",
    "privacy.scheduled": "Programma",
    "privacy.private": "Privato",
    "publish.suffix": "Lyric video",
    "publish.credits": "Creato con strumenti AI.",
    "publish.at": "Data e ora di pubblicazione",
    "publish.video": "Video",
    "publish.wait": "Caricamento in corso. Il video rimane privato.",
    "qa.pass": "Superato",
    "qa.fail": "Non superato",
    "qa.override": "Motivo approvazione con eccezione",
    "qa.gate": "Controllo",
    "qa.value": "Valore",
    "action.approveVideo": "Approva video",
    "action.retry": "Riprova",
    "panel.wait": "Il prossimo passaggio verrà mostrato qui.",
    "panel.queued": "Generazione in coda. In attesa del worker.",
    "panel.published": "Video pubblicato",
    "worker.since": "dal",
    "worker.unknown": "Mai connesso",
    "pipeline.title": "Avanzamento",
    "pipeline.imported": "Importato dal progetto originale",
    "media.master": "Video completo · anteprima 720p",
    "media.hook": "Anteprima hook",
    "media.thumbnail": "Miniatura del video",
    "media.unavailable": "Anteprima non disponibile",
    "take.label": "Take",
    "lyrics.exclude": "Esclusioni",
    "lyrics.settings": "Impostazioni (JSON)",
    "lyrics.displayMap": "Mappa visualizzazione (JSON)",
    "lyrics.l10n": "Localizzazione (JSON)",
    "validation.pack": "Controlla i campi del testo.",
    "validation.lines": "Il tema VBP richiede 80 righe cantate.",
    "validation.dash": "Rimuovi il trattino lungo dal campo.",
    "validation.json": "JSON non valido",
    "language.it": "IT",
    "language.en": "EN",
    "stage.draft_lyrics": "Bozza testi",
    "stage.generate_song": "Generazione canzone",
    "stage.timing": "Sincronizzazione",
    "stage.storyboard": "Storyboard",
    "stage.render_master": "Video principale",
    "stage.render_hook": "Video breve",
    "stage.qa": "Controlli qualità",
    "stage.art": "Copertina",
    "stage.publish": "Caricamento",
    "stage.set_privacy": "Visibilità",
    "stage.import_legacy": "Importazione",
    "stage.stems": "Separazione stems",
    "stage.visualizer": "Video visualizer",
    "stage.replace_section": "Riscrittura di una parte",
    "stage.import_audio": "Importazione dell'audio",
    "stage.remake_ingest": "Rifai da YouTube: download",
    "stage.remake_analyse": "Rifai da YouTube: analisi",
    "stage.remake_rewrite": "Rifai da YouTube: testo nuovo",
    "stage.lyrics_assist": "Testo con AI",
    "stage.align_lyrics": "Sincronizzazione testo",
    "stage.music_video_plan": "Piano del video musicale",
    "job.queued": "In coda",
    "job.running": "In corso",
    "job.done": "Completato",
    "job.failed": "Non riuscito",
    "job.cancelled": "Annullato",
    "app.name": "mellodifai",
    "nav.library": "Libreria",
    "nav.newProject": "Nuovo progetto",
    "status.analysing": "Rifai da YouTube",
    "status.drafting": "Bozza testi",
    "status.lyrics_review": "Revisione testi",
    "status.song_queued": "Canzone in coda",
    "status.takes_review": "Revisione take",
    "status.audio_ready": "Solo audio",
    "status.producing": "Produzione",
    "status.video_review": "Revisione video",
    "status.approved": "Approvato",
    "status.publishing": "Pubblicazione",
    "status.published": "Pubblicato",
    "status.failed": "Non riuscito",
    "auth.email": "Indirizzo email",
    "auth.sendLink": "Invia link di accesso",
    "auth.sent": "Se l'indirizzo è abilitato riceverai un link.",
    "action.backToLyrics": "Torna ai testi",
    "action.retryKieFree": "Riprova (gratis, controlla di nuovo kie)",
    "publish.quotaWait":
      "In attesa della quota YouTube di domani (dalle {time})",
    "publish.privacy": "Visibilità",
    "visibility.private": "Privato",
    "visibility.public": "Pubblico",
    "visibility.unlisted": "Non in elenco",
    "visibility.scheduled": "Programmato",
    "media.youtube": "YouTube",
    "resolve.kieId": "ID attività Kie",
    "resolve.videoId": "ID video YouTube",
    "resolve.notCharged": "Non addebitato",
    "resolve.notUploaded": "Non caricato",
    "resolve.charged": "Addebitato, ID attività ...",
    "resolve.uploaded": "Caricato, ID video ...",
    "auth.unavailable":
      "Servizio temporaneamente non disponibile. Riprova tra poco.",
    "auth.rateLimited": "Troppi tentativi, riprova tra qualche minuto",
    "auth.code": "Codice a 6 cifre",
    "auth.verifyCode": "Accedi con il codice",
    "action.approveGeneration": "Approva e genera la canzone: 12 crediti kie",
    "auth.notAllowed": "Se l'indirizzo è abilitato riceverai un link.",
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
    "action.newRender": "Nuovo render",
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
    "app.description": "Your music, from lyrics to video.",
    "value.unknown": "Unavailable",
    "qa.integrated_loudness": "Integrated loudness",
    "qa.true_peak": "True peak",
    "qa.crushed_words": "Crushed words",
    "qa.duration": "Duration",
    "qa.notMeasured": "Not measured",
    "publish.tag": "lyric video",
    "error.action": "Action failed. Please try again.",
    "error.unauthorized": "Sign in to continue.",
    "error.forbidden_scope": "You do not have permission for this action.",
    "error.not_found": "Item not found.",
    "error.conflict": "The item is not in the required state.",
    "error.idempotency_mismatch":
      "This key was already used for a different request.",
    "error.in_progress":
      "The request is already in progress. Try again shortly.",
    "error.ambiguous_spend":
      "The spending outcome is still unknown. Check before retrying.",
    "error.validation": "Check the information you entered.",
    "error.cap_exceeded": "Spending cap reached.",
    "error.rate_limited": "Too many attempts. Try again shortly.",
    "error.internal": "Internal error. Please try again.",
    "auth.invalidLink": "Invalid or expired link. Request a new link.",
    "auth.invalidCode": "Invalid or expired code. Request a new code.",
    "job.superseded": "Earlier attempt failed",
    "error.details": "Technical details",
    "lyrics.advanced": "Advanced settings",
    "auth.devInbox":
      "Local environment: emails never leave this PC. Open the test inbox for the link.",
    "library.title": "Your projects",
    "library.updated": "Updated",
    "project.heading": "Create a new song",
    "project.subtitle": "VBP theme, from draft to video.",
    "project.label": "Project",
    "project.theme": "Theme: VBP",
    "voice.f": "Female",
    "voice.m": "Male",
    "dialog.generation": "Confirm new generation",
    "dialog.cost": "This will spend 12 kie credits for this language.",
    "dialog.visibility": "Confirm visibility",
    "privacy.public": "Make public",
    "privacy.unlisted": "Make unlisted",
    "privacy.scheduled": "Schedule",
    "privacy.private": "Private",
    "publish.suffix": "Lyric video",
    "publish.credits": "Created with AI tools.",
    "publish.at": "Publication date and time",
    "publish.video": "Video",
    "publish.wait": "Upload in progress. The video remains private.",
    "qa.pass": "Pass",
    "qa.fail": "Fail",
    "qa.override": "Approval override reason",
    "qa.gate": "Check",
    "qa.value": "Value",
    "action.approveVideo": "Approve video",
    "action.retry": "Retry",
    "panel.wait": "The next step will appear here.",
    "panel.queued": "Generation queued. Waiting for the worker.",
    "panel.published": "Video published",
    "worker.since": "since",
    "worker.unknown": "Never connected",
    "pipeline.title": "Pipeline",
    "pipeline.imported": "Imported from the original project",
    "media.master": "Full video · 720p preview",
    "media.hook": "Hook preview",
    "media.thumbnail": "Video thumbnail",
    "media.unavailable": "Preview unavailable",
    "take.label": "Take",
    "lyrics.exclude": "Exclude",
    "lyrics.settings": "Settings (JSON)",
    "lyrics.displayMap": "Display map (JSON)",
    "lyrics.l10n": "Localization (JSON)",
    "validation.pack": "Check the lyric pack fields.",
    "validation.lines": "The VBP theme requires 80 sung lines.",
    "validation.dash": "Remove the em dash from the field.",
    "validation.json": "Invalid JSON",
    "language.it": "IT",
    "language.en": "EN",
    "stage.draft_lyrics": "Lyrics draft",
    "stage.generate_song": "Song generation",
    "stage.timing": "Lyric timing",
    "stage.storyboard": "Storyboard",
    "stage.render_master": "Main video",
    "stage.render_hook": "Short video",
    "stage.qa": "Quality checks",
    "stage.art": "Thumbnail",
    "stage.publish": "Upload",
    "stage.set_privacy": "Visibility",
    "stage.import_legacy": "Import",
    "stage.stems": "Stem separation",
    "stage.visualizer": "Visualizer video",
    "stage.replace_section": "Rewrite of a part",
    "stage.import_audio": "Audio import",
    "stage.remake_ingest": "Remake from YouTube: download",
    "stage.remake_analyse": "Remake from YouTube: analysis",
    "stage.remake_rewrite": "Remake from YouTube: new lyrics",
    "stage.lyrics_assist": "AI lyrics",
    "stage.align_lyrics": "Lyrics synchronization",
    "stage.music_video_plan": "Music video plan",
    "job.queued": "Queued",
    "job.running": "Running",
    "job.done": "Done",
    "job.failed": "Failed",
    "job.cancelled": "Cancelled",
    "app.name": "mellodifai",
    "nav.library": "Library",
    "nav.newProject": "New project",
    "status.analysing": "Remake from YouTube",
    "status.drafting": "Drafting lyrics",
    "status.lyrics_review": "Lyrics review",
    "status.song_queued": "Song queued",
    "status.takes_review": "Takes review",
    "status.audio_ready": "Audio only",
    "status.producing": "Producing",
    "status.video_review": "Video review",
    "status.approved": "Approved",
    "status.publishing": "Publishing",
    "status.published": "Published",
    "status.failed": "Failed",
    "auth.email": "Email address",
    "auth.sendLink": "Send sign-in link",
    "auth.sent": "If the address is enabled, you will receive a link.",
    "action.backToLyrics": "Back to lyrics",
    "action.retryKieFree": "Retry (free, checks kie again)",
    "publish.quotaWait": "Waiting for tomorrow's YouTube quota (from {time})",
    "publish.privacy": "Privacy",
    "visibility.private": "Private",
    "visibility.public": "Public",
    "visibility.unlisted": "Unlisted",
    "visibility.scheduled": "Scheduled",
    "media.youtube": "YouTube",
    "resolve.kieId": "Kie task id",
    "resolve.videoId": "YouTube video id",
    "resolve.notCharged": "Not charged",
    "resolve.notUploaded": "Not uploaded",
    "resolve.charged": "Charged, task id ...",
    "resolve.uploaded": "Uploaded, video id ...",
    "auth.unavailable":
      "Service temporarily unavailable. Please try again shortly.",
    "auth.rateLimited": "Too many attempts, please try again in a few minutes",
    "auth.code": "6-digit code",
    "auth.verifyCode": "Sign in with code",
    "action.approveGeneration": "Approve and generate song: 12 kie credits",
    "auth.notAllowed": "If the address is enabled, you will receive a link.",
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
    "action.newRender": "New render",
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
// Publication text follows the recording's language, independently of the app locale.
export function publicationCopy(language: string) {
  const copy: Record<string, [string, string, string]> = {
    it: ["Lyric video", "Creato con strumenti AI.", "lyric video"],
    en: ["Lyric video", "Created with AI tools.", "lyric video"],
    fr: [
      "Vidéo avec paroles",
      "Créé avec des outils d’intelligence artificielle.",
      "vidéo avec paroles",
    ],
    de: ["Songtextvideo", "Mit KI-Werkzeugen erstellt.", "Songtextvideo"],
    es: [
      "Vídeo con letra",
      "Creado con herramientas de IA.",
      "vídeo con letra",
    ],
    pt: ["Vídeo com letra", "Criado com ferramentas de IA.", "vídeo com letra"],
    ro: [
      "Videoclip cu versuri",
      "Creat cu instrumente de inteligență artificială.",
      "videoclip cu versuri",
    ],
    ru: [
      "Видео с текстом",
      "Создано с помощью инструментов ИИ.",
      "видео с текстом",
    ],
    ja: ["歌詞付き動画", "AIツールを使用して制作しました。", "歌詞付き動画"],
    zh: ["歌词视频", "使用人工智能工具制作。", "歌词视频"],
    ko: ["가사 영상", "AI 도구로 제작했습니다.", "가사 영상"],
  };
  const [suffix, credits, tag] = copy[language] ?? [
    "Lyric video",
    "Created with AI tools.",
    "lyric video",
  ];
  return { suffix, credits, tag };
}
