// Words of the public site, in Italian and English. All of it is ours (clean room: no text of the
// reference site; the clean-room judge checks it). Agent names are product names and stay as is.
import type { RecipeKind } from "@mellodifai/shared";
import type { AgentName, RouteName } from "./nav";
import type { CellText, CompareGroup, CompareRow } from "./plans";

export type SiteLang = "it" | "en";

type Plan = { name: string; line: string; items: string[]; action: string };
type Question = { q: string; a: string };
type Kind = { name: string; line: string };

export type SiteCopy = {
  meta: { title: string; description: string };
  skip: string;
  brandHome: string;
  nav: Record<RouteName, string>;
  agentsMenu: string;
  agentLine: Record<AgentName, string>;
  menu: { open: string; close: string; label: string };
  hero: {
    titleA: string;
    titleB: string;
    accent: string;
    titleEnd: string;
    lede: string;
    primary: string;
    studioLabel: string;
    song: string;
    key: string;
    tempo: string;
    take: string;
    lineLabel: string;
    lineStart: string;
    lineEnd: string;
    wordLabel: string;
    words: { word: string; take: string }[];
    play: string;
    pause: string;
    nowPlaying: string;
    ready: string;
    missing: string;
    status: string;
    lanes: [string, string, string];
    kindsLabel: string;
    agentsLabel: string;
  };
  showcase: {
    title: string;
    line: string;
    action: string;
    examples: string;
    songs: { title: string; meta: string }[];
  };
  steps: { title: string; items: { title: string; line: string }[] };
  features: {
    title: string;
    line: string;
    items: {
      label: string;
      title: string;
      points: string[];
      caption: string;
    }[];
    sheet: {
      lines: string[];
      editLine: number;
      from: string;
      to: string;
      bar: string;
      foot: string;
    };
    voice: { lanes: [string, string, string]; foot: string };
    out: { rows: { name: string; meta: string }[]; foot: string };
  };
  platform: {
    title: string;
    link: string;
    notes: { title: string; line: string }[];
    shot: string;
  };
  kinds: { title: string; line: string; items: Kind[]; label: string };
  plans: {
    title: string;
    monthly: string;
    yearly: string;
    switchLabel: string;
    price: string;
    period: { monthly: string; yearly: string };
    compare: string;
    recommended: string;
    items: Plan[];
  };
  faq: { title: string; items: Question[] };
  pricing: {
    meta: { title: string; description: string };
    title: string;
    line: string;
    compareTitle: string;
    featureColumn: string;
    included: string;
    notIncluded: string;
    groups: Record<CompareGroup, string>;
    rows: Record<CompareRow, string>;
    cells: Record<CellText, string>;
    faqTitle: string;
    faq: Question[];
  };
  closing: { title: string; action: string; note: string; label: string };
  notFound: {
    meta: { title: string; description: string };
    code: string;
    title: string;
    line: string;
    home: string;
  };
  recipes: {
    meta: { title: string; description: string };
    title: string;
    line: string;
    searchLabel: string;
    searchPlaceholder: string;
    clearSearch: string;
    empty: string;
    emptyHint: string;
    resetSearch: string;
    viewLabel: string;
    viewCanvas: string;
    viewGrid: string;
    zoomLabel: string;
    zoomOut: string;
    zoomIn: string;
    zoomReset: string;
    canvasLabel: string;
    gridLabel: string;
    openAction: string;
    kinds: Record<RecipeKind, string>;
  };
  footer: {
    tagline: string;
    heads: { make: string; learn: string; legal: string };
    label: string;
    copyright: string;
    signoff: string;
  };
};

const en: SiteCopy = {
  meta: {
    title: "MellodifAI - change a word, hear it sung",
    description:
      "MellodifAI makes songs you can edit like text: rewrite a line, remake a track from a link, publish the video.",
  },
  skip: "Skip to content",
  brandHome: "MellodifAI, home",
  nav: {
    home: "Home",
    start: "Start a song",
    signIn: "Log in",
    songbook: "Songbook",
    desktop: "Desktop app",
    agents: "Agents",
    plans: "Prices",
    changelog: "What's new",
    guides: "Lessons",
    support: "Write to the team",
    privacy: "Your data",
    terms: "Terms of use",
  },
  agentsMenu: "Agents",
  agentLine: {
    claude: "Use MellodifAI from Claude",
    chatgpt: "Use MellodifAI from ChatGPT",
    gemini: "Use MellodifAI from Gemini",
    codex: "Use MellodifAI from Codex",
    cursor: "Use MellodifAI from Cursor",
  },
  menu: { open: "Open the menu", close: "Close the menu", label: "Site menu" },
  hero: {
    titleA: "Change a word.",
    titleB: "Hear it",
    accent: "sung",
    titleEnd: ".",
    lede: "MellodifAI makes songs you can edit like text: rewrite a line, remake a track from a link, publish the video.",
    primary: "Start a song",
    studioLabel: "Try one edit: pick the last word of the line, then play it.",
    song: "Edge of town",
    key: "A minor",
    tempo: "96 BPM",
    take: "Take 03",
    lineLabel: "Verse 2, line 3",
    lineStart: "you sing along to a song I",
    lineEnd: ",",
    wordLabel: "Last word of the line",
    words: [
      { word: "hate", take: "as recorded" },
      { word: "love", take: "sung again" },
    ],
    play: "Play the line",
    pause: "Pause",
    nowPlaying: "Playing",
    ready: "Same voice, same band. Only the word changes.",
    missing:
      "The sample clip is not online yet. Start a song to hear your own line.",
    status: "Line 3 sung again in the same voice",
    lanes: ["Words", "Voice", "Band"],
    kindsLabel: "Recipes",
    agentsLabel: "or from your agent",
  },
  showcase: {
    title: "Made with MellodifAI",
    line: "Examples of what one recipe gives you, each one a song you can keep editing.",
    action: "Start a song",
    examples: "Example songs",
    songs: [
      { title: "Edge of town, faster", meta: "Remix, 124 BPM" },
      { title: "Our wedding song, slow", meta: "Cover, 72 BPM" },
      { title: "Happy birthday, Dana", meta: "Satire, 108 BPM" },
      { title: "Night bus, in Italian", meta: "Translation, 90 BPM" },
      { title: "Kitchen radio", meta: "Karaoke, 100 BPM" },
      { title: "Twelve floors up", meta: "Lyric video, 118 BPM" },
    ],
  },
  steps: {
    title: "From the song you have to the song you want",
    items: [
      {
        title: "Bring a song",
        line: "Paste a link or drop a file. MellodifAI finds the words, the beat and the voice.",
      },
      {
        title: "Change it",
        line: "Select a word and type a new one. The line is sung again; the rest stays.",
      },
      {
        title: "Take it out",
        line: "Keep the audio, the stems, or a lyric video that is ready to post.",
      },
    ],
  },
  features: {
    title: "Three parts of a song, each one yours to change",
    line: "The words, the voice and what you do with the finished take.",
    items: [
      {
        label: "01 Words",
        title: "Edit a line, a word, a verse",
        points: [
          "The rhyme and the syllable count stay in place.",
          "Every edit is a new take. The old one stays.",
          "Undo goes back one take at a time.",
        ],
        caption: "Verse 2, line 3. One word changed, one line sung again.",
      },
      {
        label: "02 Voice",
        title: "Keep the singer, or change the singer",
        points: [
          "The voice and the band come apart as stems.",
          "Sing the same line in another voice.",
          "The timing of the first take is kept.",
        ],
        caption: "Voice and band on their own lanes.",
      },
      {
        label: "03 Out",
        title: "Take it out of the studio",
        points: [
          "A lyric video with the words on the beat.",
          "Karaoke with the voice turned down.",
          "Files sized for each place you post.",
        ],
        caption: "One take, three ways out.",
      },
    ],
    sheet: {
      lines: [
        "Radio low and the windows down,",
        "last train gone from the edge of town,",
        "you sing along to a song I love,",
        "and the streetlights hum the tune.",
      ],
      editLine: 2,
      from: "hate",
      to: "love",
      bar: "Verse 2",
      foot: "The other three lines stay as they are.",
    },
    voice: {
      lanes: ["Voice", "Band", "New voice"],
      foot: "Stems ready: voice and band.",
    },
    out: {
      rows: [
        { name: "Lyric video", meta: "1080 x 1920, words on the beat" },
        { name: "Karaoke", meta: "Voice at 10 percent" },
        { name: "Audio and stems", meta: "WAV and MP3" },
      ],
      foot: "Ready to post.",
    },
  },
  platform: {
    title: "The studio, as it really works",
    link: "See the desktop app",
    shot: "The MellodifAI studio: the song list on the left, the lyric of the open song in the middle, the takes on the right.",
    notes: [
      {
        title: "Here or in the cloud",
        line: "Jobs run on your computer or in the cloud, and the studio says which.",
      },
      {
        title: "Real state, real cost",
        line: "Every job shows where it is and what it costs before it starts.",
      },
      {
        title: "Your agent can drive it",
        line: "Agents use the same tools you see, with your permission.",
      },
    ],
  },
  kinds: {
    title: "One song, many recipes",
    line: "Choose what the song becomes. Each recipe opens in the editor with an example.",
    label: "Recipe kinds",
    items: [
      {
        name: "Remix",
        line: "Keep the melody, change the style, the tempo or the mood.",
      },
      {
        name: "Cover",
        line: "A song you know, sung in a new voice and a new key.",
      },
      {
        name: "Pantomime",
        line: "The tune stays, the words tell a story for the stage.",
      },
      {
        name: "Satire",
        line: "Keep the tune, rewrite the words for a roast or a send-off.",
      },
      {
        name: "Translation",
        line: "The same song in another language, still on the beat.",
      },
      {
        name: "Karaoke",
        line: "The band without the voice, with the words on screen.",
      },
      {
        name: "Lyric video",
        line: "The words of the song, timed to the voice, ready to post.",
      },
    ],
  },
  plans: {
    title: "Plans that grow with the songs you make",
    monthly: "Monthly",
    yearly: "Yearly",
    switchLabel: "How often you pay",
    price: "Owner decides prices",
    period: { monthly: "per month", yearly: "per year" },
    compare: "Compare the plans",
    recommended: "Most chosen",
    items: [
      {
        name: "Try",
        line: "One song to see how it works.",
        items: ["One song", "Word and line edits", "Export to MP3"],
        action: "Try it",
      },
      {
        name: "Maker",
        line: "For people who write a song now and then.",
        items: [
          "Songs from a prompt or a link",
          "Remix and cover recipes",
          "Lyric video export",
        ],
        action: "Choose Maker",
      },
      {
        name: "Studio",
        line: "For people who make songs every week.",
        items: [
          "Everything in Maker",
          "Stems for voice and band",
          "Desktop app and agent access",
        ],
        action: "Choose Studio",
      },
      {
        name: "Label",
        line: "For teams who release songs.",
        items: [
          "Everything in Studio",
          "Shared songbook",
          "Publishing to your channels",
        ],
        action: "Choose Label",
      },
    ],
  },
  faq: {
    title: "Questions people ask first",
    items: [
      {
        q: "Which devices and browsers does it run on?",
        a: "Any recent browser on Windows, macOS, Linux, Android or iOS. The desktop app is ready for Windows; macOS and Linux follow.",
      },
      {
        q: "Does it run on my computer or in the cloud?",
        a: "Both. The studio tells you where each job runs, and you can choose.",
      },
      {
        q: "Can my own agent use MellodifAI?",
        a: "Yes. Claude, ChatGPT, Gemini, Codex and Cursor can connect through our server or our command line tool, with your permission.",
      },
      {
        q: "Is my song private?",
        a: "Your songs are yours. A song is private until you choose to publish it.",
      },
      {
        q: "How do I take a song out?",
        a: "Export the audio, the stems, a karaoke track or a lyric video from the editor.",
      },
    ],
  },
  pricing: {
    meta: {
      title: "Plans - MellodifAI",
      description:
        "Four MellodifAI plans side by side: what each one holds, and answers about paying, credits and privacy.",
    },
    title: "Pick a plan for the songs you make",
    line: "The prices come later. Every plan opens the same studio. How plans change and end is set together with the prices.",
    compareTitle: "Every plan, side by side",
    featureColumn: "What you get",
    included: "Included",
    notIncluded: "Not in this plan",
    groups: {
      songs: "Songs",
      editing: "Editing",
      voice: "Voice",
      publishing: "Publishing",
      agents: "Agents and help",
    },
    rows: {
      prompt: "A song from a prompt",
      link: "A remake from a link",
      recipes: "Remix and cover recipes",
      word: "Change a word or a line",
      section: "Rewrite a whole section",
      takes: "Choose between takes",
      stems: "Voice and band as separate tracks",
      translate: "The song in another language",
      karaoke: "Karaoke track",
      mp3: "MP3 export",
      video: "Lyric video",
      channels: "Publish to your channels",
      desktop: "Desktop app",
      agentAccess: "Claude, ChatGPT, Gemini, Codex and Cursor",
      songbook: "One songbook for the team",
      help: "Help",
    },
    cells: {
      guides: "Guides",
      email: "By email",
      faster: "First in line",
    },
    faqTitle: "Plans, asked and answered",
    faq: [
      {
        q: "How does a plan end, and can I change it?",
        a: "When a plan ends and how you change plans is set together with the prices. Your songs stay yours.",
      },
      {
        q: "Is there a plan that costs nothing?",
        a: "The first plan is there to try the studio with one song. What it holds and what it costs is decided together with the other prices.",
      },
      {
        q: "What does a credit pay for?",
        a: "Work that runs on a paid engine, such as a new take of a song. Work that runs on your own computer uses no credits.",
      },
      {
        q: "What happens when my credits run out?",
        a: "What happens when credits run out, and whether you can add more, is published together with the prices.",
      },
      {
        q: "How do I pay?",
        a: "Payment opens when the prices are set. Until then nothing is charged.",
      },
      {
        q: "Who can hear my songs?",
        a: "Only you, until you publish a song or share its link. Your plan does not change that.",
      },
      {
        q: "Can I work on my own computer?",
        a: "Yes. Work that runs on your own computer uses no credits.",
      },
    ],
  },
  closing: {
    title: "Your next take is one word away",
    action: "Start a song",
    note: "Runs in your browser. No download needed.",
    label: "Covers of example songs",
  },
  notFound: {
    meta: {
      title: "Page not found - MellodifAI",
      description: "This page does not exist on MellodifAI.",
    },
    code: "404",
    title: "This page is not here",
    line: "The link may be old, or the address may have a typo.",
    home: "Back to home",
  },
  recipes: {
    meta: {
      title: "Songbook - MellodifAI",
      description:
        "Browse song recipes for remixes, covers, pantomimes and musical satire. Pick one and open it in MellodifAI.",
    },
    title: "Songbook",
    line: "Pick a finished song recipe and shape it with your own track or lyrics.",
    searchLabel: "Filter songbook",
    searchPlaceholder: "Search songs, genres, or formats...",
    clearSearch: "Clear filter",
    empty: "No song recipes match that query.",
    emptyHint:
      "Try a kind like remix, cover, satire, or a destination like YouTube.",
    resetSearch: "Show every song recipe",
    viewLabel: "Display mode",
    viewCanvas: "Canvas",
    viewGrid: "Grid",
    zoomLabel: "Canvas magnification",
    zoomOut: "Decrease zoom",
    zoomIn: "Increase zoom",
    zoomReset: "Return magnification to 100%",
    canvasLabel:
      "Interactive songbook canvas. Drag or use arrow keys to pan; use plus and minus to zoom.",
    gridLabel: "Songbook grid",
    openAction: "Open in studio",
    kinds: {
      remix: "Remix",
      cover: "Cover",
      pantomime: "Pantomime",
      satire: "Satire",
    },
  },
  footer: {
    tagline: "Every song is a draft.",
    heads: { make: "Make", learn: "Learn", legal: "Fine print" },
    label: "Site links",
    copyright: "© 2026 MellodifAI",
    signoff: "For people who cannot leave a lyric alone.",
  },
};

const it: SiteCopy = {
  meta: {
    title: "MellodifAI - cambia una parola, sentila cantata",
    description:
      "Con MellodifAI una canzone si modifica come un testo: riscrivi un verso, rifai un brano da un link, pubblica il video.",
  },
  skip: "Vai al contenuto",
  brandHome: "MellodifAI, pagina iniziale",
  nav: {
    home: "Home",
    start: "Inizia una canzone",
    signIn: "Accedi",
    songbook: "Canzoniere",
    desktop: "App desktop",
    agents: "Agenti",
    plans: "Piani",
    changelog: "Novità",
    guides: "Lezioni",
    support: "Scrivici",
    privacy: "I tuoi dati",
    terms: "Condizioni d'uso",
  },
  agentsMenu: "Agenti",
  agentLine: {
    claude: "Usa MellodifAI da Claude",
    chatgpt: "Usa MellodifAI da ChatGPT",
    gemini: "Usa MellodifAI da Gemini",
    codex: "Usa MellodifAI da Codex",
    cursor: "Usa MellodifAI da Cursor",
  },
  menu: {
    open: "Apri il menu",
    close: "Chiudi il menu",
    label: "Menu del sito",
  },
  hero: {
    titleA: "Cambia una parola.",
    titleB: "Sentila",
    accent: "cantata",
    titleEnd: ".",
    lede: "Con MellodifAI una canzone si modifica come un testo: riscrivi un verso, rifai un brano da un link, pubblica il video.",
    primary: "Inizia una canzone",
    studioLabel:
      "Prova una modifica: scegli l'ultima parola del verso, poi ascoltalo.",
    song: "Edge of town",
    key: "La minore",
    tempo: "96 BPM",
    take: "Take 03",
    lineLabel: "Strofa 2, verso 3",
    lineStart: "you sing along to a song I",
    lineEnd: ",",
    wordLabel: "Ultima parola del verso",
    words: [
      { word: "hate", take: "come registrata" },
      { word: "love", take: "cantata di nuovo" },
    ],
    play: "Ascolta il verso",
    pause: "Pausa",
    nowPlaying: "In ascolto",
    ready: "Stessa voce, stessa band. Cambia solo la parola.",
    missing:
      "Il campione audio non è ancora online. Inizia una canzone per ascoltare il tuo verso.",
    status: "Verso 3 cantato di nuovo con la stessa voce",
    lanes: ["Parole", "Voce", "Band"],
    kindsLabel: "Ricette",
    agentsLabel: "oppure dal tuo agente",
  },
  showcase: {
    title: "Fatto con MellodifAI",
    line: "Esempi di quello che dà una ricetta: ogni brano resta da modificare.",
    action: "Inizia una canzone",
    examples: "Canzoni di esempio",
    songs: [
      { title: "Edge of town, più veloce", meta: "Remix, 124 BPM" },
      { title: "La nostra canzone, lenta", meta: "Cover, 72 BPM" },
      { title: "Buon compleanno, Dana", meta: "Satira, 108 BPM" },
      { title: "Autobus di notte, in italiano", meta: "Traduzione, 90 BPM" },
      { title: "Radio in cucina", meta: "Karaoke, 100 BPM" },
      { title: "Dodici piani più su", meta: "Video del testo, 118 BPM" },
    ],
  },
  steps: {
    title: "Dalla canzone che hai alla canzone che vuoi",
    items: [
      {
        title: "Porta una canzone",
        line: "Incolla un link o trascina un file. MellodifAI trova parole, ritmo e voce.",
      },
      {
        title: "Cambiala",
        line: "Seleziona una parola e scrivine una nuova. Il verso viene cantato di nuovo, il resto non cambia.",
      },
      {
        title: "Portala fuori",
        line: "Tieni l'audio, le tracce separate o un video del testo pronto da pubblicare.",
      },
    ],
  },
  features: {
    title: "Tre parti della canzone, ognuna da cambiare",
    line: "Le parole, la voce e quello che fai con la take finita.",
    items: [
      {
        label: "01 Parole",
        title: "Modifica un verso, una parola, una strofa",
        points: [
          "Rima e numero di sillabe restano al loro posto.",
          "Ogni modifica è una nuova take. La vecchia resta.",
          "Annulla torna indietro di una take alla volta.",
        ],
        caption:
          "Strofa 2, verso 3. Una parola cambiata, un verso cantato di nuovo.",
      },
      {
        label: "02 Voce",
        title: "Tieni il cantante, o cambialo",
        points: [
          "Voce e band si separano in tracce.",
          "Canta lo stesso verso con un'altra voce.",
          "Il tempo della prima take resta uguale.",
        ],
        caption: "Voce e band su corsie separate.",
      },
      {
        label: "03 Fuori",
        title: "Porta la canzone fuori dallo studio",
        points: [
          "Un video del testo con le parole a tempo.",
          "Karaoke con la voce abbassata.",
          "File della misura giusta per ogni piattaforma.",
        ],
        caption: "Una take, tre strade.",
      },
    ],
    sheet: {
      lines: [
        "Radio low and the windows down,",
        "last train gone from the edge of town,",
        "you sing along to a song I love,",
        "and the streetlights hum the tune.",
      ],
      editLine: 2,
      from: "hate",
      to: "love",
      bar: "Strofa 2",
      foot: "Gli altri tre versi restano come sono.",
    },
    voice: {
      lanes: ["Voce", "Band", "Nuova voce"],
      foot: "Tracce pronte: voce e band.",
    },
    out: {
      rows: [
        { name: "Video del testo", meta: "1080 x 1920, parole a tempo" },
        { name: "Karaoke", meta: "Voce al 10 per cento" },
        { name: "Audio e tracce", meta: "WAV e MP3" },
      ],
      foot: "Pronto da pubblicare.",
    },
  },
  platform: {
    title: "Lo studio, come funziona davvero",
    link: "Scopri l'app desktop",
    shot: "Lo studio di MellodifAI: a sinistra le canzoni, al centro il testo della canzone aperta, a destra le take.",
    notes: [
      {
        title: "Qui o nel cloud",
        line: "I lavori girano sul tuo computer o nel cloud, e lo studio dice dove.",
      },
      {
        title: "Stato vero, costo vero",
        line: "Ogni lavoro mostra a che punto è e quanto costa prima di partire.",
      },
      {
        title: "Il tuo agente può guidarlo",
        line: "Gli agenti usano gli stessi strumenti che vedi tu, con il tuo permesso.",
      },
    ],
  },
  kinds: {
    title: "Una canzone, tante ricette",
    line: "Scegli cosa diventa la canzone. Ogni ricetta si apre nell'editor con un esempio.",
    label: "Tipi di ricetta",
    items: [
      {
        name: "Remix",
        line: "Tieni la melodia, cambia stile, tempo o atmosfera.",
      },
      {
        name: "Cover",
        line: "Una canzone che conosci, con una nuova voce e una nuova tonalità.",
      },
      {
        name: "Pantomima",
        line: "La melodia resta, le parole raccontano una storia per il palco.",
      },
      {
        name: "Satira",
        line: "Tieni la melodia, riscrivi le parole per una festa o un saluto.",
      },
      {
        name: "Traduzione",
        line: "La stessa canzone in un'altra lingua, sempre a tempo.",
      },
      {
        name: "Karaoke",
        line: "La band senza la voce, con le parole sullo schermo.",
      },
      {
        name: "Video del testo",
        line: "Le parole della canzone, a tempo con la voce, pronte da pubblicare.",
      },
    ],
  },
  plans: {
    title: "Piani che crescono con le canzoni che fai",
    monthly: "Mensile",
    yearly: "Annuale",
    switchLabel: "Periodo di pagamento",
    price: "Prezzi decisi dal titolare",
    period: { monthly: "al mese", yearly: "all'anno" },
    compare: "Confronta i piani",
    recommended: "Il più scelto",
    items: [
      {
        name: "Prova",
        line: "Una canzone per vedere come funziona.",
        items: [
          "Una canzone",
          "Modifiche di parole e versi",
          "Esportazione in MP3",
        ],
        action: "Prova",
      },
      {
        name: "Maker",
        line: "Per chi scrive una canzone ogni tanto.",
        items: [
          "Canzoni da un prompt o da un link",
          "Ricette remix e cover",
          "Esportazione del video del testo",
        ],
        action: "Scegli Maker",
      },
      {
        name: "Studio",
        line: "Per chi fa canzoni ogni settimana.",
        items: [
          "Tutto di Maker",
          "Tracce separate di voce e band",
          "App desktop e accesso per agenti",
        ],
        action: "Scegli Studio",
      },
      {
        name: "Label",
        line: "Per i gruppi che pubblicano canzoni.",
        items: [
          "Tutto di Studio",
          "Canzoniere condiviso",
          "Pubblicazione sui tuoi canali",
        ],
        action: "Scegli Label",
      },
    ],
  },
  faq: {
    title: "Le prime domande",
    items: [
      {
        q: "Su quali dispositivi e browser funziona?",
        a: "Su ogni browser recente, con Windows, macOS, Linux, Android o iOS. L'app desktop è pronta per Windows; macOS e Linux arrivano dopo.",
      },
      {
        q: "Gira sul mio computer o nel cloud?",
        a: "Tutte e due. Lo studio ti dice dove gira ogni lavoro, e puoi scegliere.",
      },
      {
        q: "Il mio agente può usare MellodifAI?",
        a: "Sì. Claude, ChatGPT, Gemini, Codex e Cursor si collegano dal nostro server o dal nostro strumento da riga di comando, con il tuo permesso.",
      },
      {
        q: "La mia canzone è privata?",
        a: "Le tue canzoni sono tue. Una canzone resta privata finché non scegli di pubblicarla.",
      },
      {
        q: "Come porto fuori una canzone?",
        a: "Dall'editor esporti l'audio, le tracce separate, una base karaoke o un video del testo.",
      },
    ],
  },
  pricing: {
    meta: {
      title: "Piani - MellodifAI",
      description:
        "I quattro piani di MellodifAI fianco a fianco: cosa contiene ciascuno, e risposte su pagamenti, crediti e privacy.",
    },
    title: "Scegli un piano per le canzoni che fai",
    line: "I prezzi arrivano più avanti. Ogni piano apre lo stesso studio. Come si cambia e come finisce un piano si decide insieme ai prezzi.",
    compareTitle: "Tutti i piani, fianco a fianco",
    featureColumn: "Cosa ottieni",
    included: "Incluso",
    notIncluded: "Non in questo piano",
    groups: {
      songs: "Canzoni",
      editing: "Modifica",
      voice: "Voce",
      publishing: "Pubblicazione",
      agents: "Agenti e aiuto",
    },
    rows: {
      prompt: "Una canzone da un prompt",
      link: "Un rifacimento da un link",
      recipes: "Ricette remix e cover",
      word: "Cambia una parola o un verso",
      section: "Riscrivi una sezione intera",
      takes: "Scegli tra più take",
      stems: "Voce e band su tracce separate",
      translate: "La canzone in un'altra lingua",
      karaoke: "Base karaoke",
      mp3: "Esportazione MP3",
      video: "Video del testo",
      channels: "Pubblica sui tuoi canali",
      desktop: "App desktop",
      agentAccess: "Claude, ChatGPT, Gemini, Codex e Cursor",
      songbook: "Un canzoniere per il gruppo",
      help: "Aiuto",
    },
    cells: {
      guides: "Guide",
      email: "Per email",
      faster: "Prima in coda",
    },
    faqTitle: "Piani, domande e risposte",
    faq: [
      {
        q: "Come finisce un piano, e posso cambiarlo?",
        a: "Quando finisce un piano e come si cambia piano si decide insieme ai prezzi. Le tue canzoni restano tue.",
      },
      {
        q: "C'è un piano che non costa nulla?",
        a: "Il primo piano serve a provare lo studio con una canzone. Cosa contiene e quanto costa si decide insieme agli altri prezzi.",
      },
      {
        q: "Cosa paga un credito?",
        a: "Il lavoro che gira su un motore a pagamento, come una nuova take di una canzone. Il lavoro che gira sul tuo computer non usa crediti.",
      },
      {
        q: "Cosa succede quando finiscono i crediti?",
        a: "Cosa succede quando finiscono i crediti, e se puoi aggiungerne altri, viene pubblicato insieme ai prezzi.",
      },
      {
        q: "Come pago?",
        a: "I pagamenti si aprono quando i prezzi sono decisi. Fino ad allora non si paga nulla.",
      },
      {
        q: "Chi può ascoltare le mie canzoni?",
        a: "Solo tu, finché non pubblichi una canzone o ne condividi il link. Il piano non cambia questo.",
      },
      {
        q: "Posso lavorare sul mio computer?",
        a: "Sì. Il lavoro che gira sul tuo computer non usa crediti.",
      },
    ],
  },
  closing: {
    title: "La prossima take è a una parola da te",
    action: "Inizia una canzone",
    note: "Funziona nel browser. Non serve scaricare nulla.",
    label: "Copertine di canzoni di esempio",
  },
  notFound: {
    meta: {
      title: "Pagina non trovata - MellodifAI",
      description: "Questa pagina non esiste su MellodifAI.",
    },
    code: "404",
    title: "Questa pagina non c'è",
    line: "Il link potrebbe essere vecchio, oppure l'indirizzo ha un errore.",
    home: "Torna alla home",
  },
  recipes: {
    meta: {
      title: "Canzoniere - MellodifAI",
      description:
        "Esplora le ricette musicali per remix, cover, pantomime e satira. Scegline una e aprila in MellodifAI.",
    },
    title: "Canzoniere",
    line: "Scegli una ricetta pronta e modellala con la tua traccia o le tue parole.",
    searchLabel: "Filtra il canzoniere",
    searchPlaceholder: "Cerca brani, generi o formati...",
    clearSearch: "Pulisci filtro",
    empty: "Nessuna ricetta musicale corrisponde alla ricerca.",
    emptyHint:
      "Prova un tipo come remix, cover, satira, oppure una destinazione come YouTube.",
    resetSearch: "Mostra tutte le ricette",
    viewLabel: "Vista del catalogo",
    viewCanvas: "Lavagna",
    viewGrid: "Griglia",
    zoomLabel: "Ingrandimento lavagna",
    zoomOut: "Riduci ingrandimento",
    zoomIn: "Aumenta ingrandimento",
    zoomReset: "Riporta ingrandimento al 100%",
    canvasLabel:
      "Lavagna interattiva del canzoniere. Trascina o usa le frecce per spostarti; più e meno per lo zoom.",
    gridLabel: "Griglia del canzoniere",
    openAction: "Apri nello studio",
    kinds: {
      remix: "Remix",
      cover: "Cover",
      pantomime: "Pantomima",
      satire: "Satira",
    },
  },
  footer: {
    tagline: "Ogni canzone è una bozza.",
    heads: { make: "Crea", learn: "Impara", legal: "Note legali" },
    label: "Link del sito",
    copyright: "© 2026 MellodifAI",
    signoff: "Per chi non lascia mai stare un testo.",
  },
};

export const SITE_COPY: Record<SiteLang, SiteCopy> = { en, it };
