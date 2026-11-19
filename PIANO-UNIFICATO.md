# MellodifAI: piano unificato

Versione 3, 14/11/2026 (punteggio del critico cieco: v1 71,5%, v2 95,6%; registro in `E:/mellodifai/research/piano/results.tsv`). Sostituisce come elenco di lavoro le sezioni 4-6 di `docs/HANDOFF.md` e la
roadmap M2a-M8. I documenti di dettaglio restano validi e sono citati per ogni voce.

**Fonte.** Ogni voce viene da una richiesta del proprietario. L'elenco congelato delle richieste (35 requisiti con peso, versione 2) è in
`E:/mellodifai/research/piano/requisiti.md`; il testo originale è in `richieste-raw.md` nella stessa cartella.
Il codice `Rnn` dopo ogni voce rimanda al requisito.

**Come leggere una voce.** Stato (cosa c'e oggi, e se e verificato) / Prossimo passo / Giudice (cosa,
oltre a chi lavora, dice che e fatto) / Dipende da.

## 0. Cosa vuole il proprietario, in una frase

Uno studio personale guidato da agenti: incolli un link YouTube o un'idea e ottieni una canzone nuova,
adattata nella tua lingua e cultura, con un video curato e pubblicato da solo sui social, al costo piu
basso possibile; gira sul PC Windows e su un VPS Debian, e migliora da solo ogni notte.

## 1. Regole permanenti (R25, R26)

- Niente database, cache, log, trascrizioni, pesi o dati di test su C:. Usare E:/mellodifai o G:. Sotto 20 GB liberi su C: fermarsi.
- Niente crediti pagati nei test. Un motore locale non ripiega mai su uno pagato in silenzio.
- Tetto per il flusso video AI: 5000 crediti kie in totale (deciso il 14/11).
- Niente segreti stampati o committati. Niente codice GPL o AGPL dentro il prodotto (servizi separati via HTTP ammessi se la licenza lo consente).
- Migrazioni solo additive con test; la migrazione di lockdown resta l'ultima (non e ri-eseguibile: le nuove devono avere versione successiva e ripetere i grant necessari).
- Niente em dash. Commit senza righe di attribuzione.
- Video del proprietario mai caricati su host esterni senza permesso. Pubblicazione pubblica solo con finestra di veto.
- Mai `docker` o `wsl` su questo PC (si bloccano dal 12/11).
- Modo di lavoro: token-lean (pochi agenti, brief su file, rapporti brevi, giudice separato dal costruttore). Crediti: il 13/11 il proprietario ha chiesto Codex come esecutore; il 14/11, nell'obiettivo /goal sul flusso video, ha scritto "don't use codex open ai cli use your credits" (testo dell'obiettivo /goal registrato nella sessione Claude 15213305 del 14/11; i comandi /goal non finiscono in `richieste-raw.md`, che legge solo i messaggi normali) e poi "execute autonomously using the improved version of /token-lean". Vale l'ultima indicazione: agenti Claude, Codex solo se lo richiede di nuovo.
- Agenti in sandbox e sub-agenti degli altri abbonamenti (OpenRouter, Cursor, ChatGPT) (R35): ammessi quando il proprietario li indica; isolamento con worktree dedicati, stack di laboratorio e nessun file di segreti, perche Docker e WSL non funzionano su questo PC.
- A piano fissato: esecuzione autonoma senza fermarsi; il proprietario viene avvisato solo per azioni sue, per un cutover di produzione e alla fine di ogni fase (R30).

## 2. Ordine delle fasi

| Fase | Contenuto | Perche in questo ordine |
|---|---|---|
| F0 | Runtime nativo chiuso e produzione riaccesa | La produzione e giu dal 12/11 |
| F1 | Audit funzionale dell'app (tutti i pulsanti, tutte le richieste gia costruite) | Sapere cosa funziona davvero prima di aggiungere |
| F2 | Motore di miglioramento autoresearch | Moltiplica tutto il lavoro dopo |
| F3 | Flusso video musicale AI (gradini 1-3) | La richiesta piu recente e di maggior valore visivo |
| F4 | Pubblicazione social multipla e chiusura M2a-M4 | Chiude il ciclo idea -> pubblicato |
| F5 | Debian VPS e installer Windows nativo | Serve il runtime chiuso (F0) |
| F6 | Idee Videohub, modelli leggeri, pulizia | Migliorie misurate una alla volta |

F2 parte appena F0 e chiusa, in parallelo a F3 e F4: lavora di notte su superfici diverse.

## F0. Runtime nativo chiuso e produzione riaccesa (R01, R02)

| Voce | Stato | Prossimo passo | Giudice |
|---|---|---|---|
| Bloccanti dati (import/restore interrotti, comandi concorrenti, backup di test in produzione, rollback, migrazioni) | Fatti 14/11 (run 8): test:db 312, ops 374 (rapporto `E:/mellodifai/codex-streams/native-runtime/run8-last.md`), prova di produzione con conteggi giusti | Nessuno | Gia superato |
| Smuggling del gateway (`Connection: content-length`) | In corso (agente Claude, brief `E:/mellodifai/codex-streams/native-runtime/run10-brief.md`) | Finire | Test raw-socket che fallisce prima: l'upstream vede una sola richiesta per metodo |
| Servizi raggiungibili senza gateway | In corso (stesso brief) | Segreto di passaggio gateway -> Auth e Storage; decisione scritta per PostgREST | Chiamata diretta senza segreto rifiutata; test:db ed e2e verdi |
| Token nei log | In corso | Log sicuri per servizio e redazione prima della scrittura | Test con segreti finti in una richiesta e in un errore SQL: nessuno arriva su disco |
| Log senza limite | In corso | Rotazione per dimensione e riserva di spazio sul volume dati | Test: i log non superano il tetto; avvio rifiutato sotto la riserva |
| Spegnimento di Windows | In corso | Arresto pulito di PostgreSQL o prova del recupero | 10 uccisioni sotto carico, dati intatti e avvio pulito ogni volta |
| Dipendenza pg-boss senza checksum | In corso | Archivio fissato con SHA-256 nel manifest | Installazione offline da cache verificata; manomissione rifiutata |
| Revisione finale del ramo | Fatta 14/11 (nessun bloccante; 11 rilievi corretti) | Un critico cieco su `8d52288..HEAD` e open-code-review | Zero bloccanti aperti |
| Build Windows invariata | Da fare | Gate completi su Windows dopo ogni cambio per Debian | lint, typecheck, test, test:db, e2e verdi su Windows |
| Merge e push | Fatto 14/11 (`main` e `build/studio-ui` a `491e6b8`) | Merge `feat/native-runtime` in `build/studio-ui` e `main` dopo tutti i gate | Gli stessi gate da una copia su E: |
| Cutover produzione | Fatto 14/11 (tag `native-20261114-r1`, conteggi verificati) | 1) copia con hash SHA-256 di `E:/mellodifai/recovery/20261113` e del disco Docker; 2) `native-import --check`; 3) `--apply`; 4) avvio; 5) verifica | Hash della copia uguali all'originale; 15 utenti, 18 progetti, 28 versioni, 24 lavori, 101 oggetti; accesso dal collegamento sul Desktop |
| Logon automatico nativo | Pronto il comando | Il proprietario esegue una volta il comando del runbook `docs/native-production.md` | Dopo un riavvio la produzione risponde da sola |

## F1. Audit funzionale (R05-R14, R16-R19, R31, R32, R34)

Molte richieste sono gia nel codice ma non verificate dal proprietario. Prima si misura, poi si aggiusta.

| Richiesta | Stato nel codice (14/11) | Prossimo passo | Giudice |
|---|---|---|---|
| UI come Suno, pulsanti, riproduzione, sovrapposizioni, copertine (R05) | UI studio, e2e `ui-polish`, `library-journey`, `glassy-ui` | Giro e2e che preme ogni pulsante visibile in ogni pagina e controlla l'effetto; screenshot 3 larghezze | Zero pulsanti senza effetto; zero sovrapposizioni; ogni canzone ha copertina |
| Testi, bozza con modello economico o locale (R06) | `draft-lyrics.ts` esiste; quale modello usa: da verificare | Fissare: bozza con modello locale o economico | 20 brief fissi: costo per bozza e tasso di bozze accettabili |
| Testi, miglioramento con modello forte (R06) | `lyrics-assist.ts`; modello da verificare | Opus o equivalente solo sulla bozza scelta | Giudizio cieco bozza contro migliorata su 20 brief: vince la migliorata in almeno 16 |
| Testi, giuria come gate (R06) | `lyric-jury.ts` | Misurare tempo e accordo dei giurati | Decisione sotto 1 s per testo con giudici locali o motivo misurato; nessun testo sotto soglia passa |
| Testi, la giuria riscrive il prompt (R06) | Da verificare | Il prompt migliorato dalla giuria e un esperimento di F2 | Punteggio del set d'oro sale senza regressioni |
| Generare o rigenerare testi dalla UI (R17) | Pulsanti nello studio, da verificare | e2e dedicato | e2e: genera, rigenera, il testo cambia e resta salvato |
| Pulsante "produci il video" a testo pronto (R31) | Da verificare: `video-card.tsx` sceglie il formato del video (16:9 + 9:16 o solo audio) nella creazione; un pulsante dedicato dopo l'approvazione del testo non risulta | e2e dal testo approvato: se il pulsante manca, aggiungerlo | e2e verde |
| Solo audio, scelta take (R07) | Opzione in `video-card`, `score-takes` | Coprire con e2e | e2e verde |
| Sostituire una parte (R08) | `replace-section.ts` | e2e dal pulsante alla nuova take | e2e verde, parola nuova udibile nella trascrizione |
| Import da Suno (R09) | `import-audio.ts` | Solo file scaricati dal proprietario (niente automazione dell'account: termini di Suno) | Import di un mp3 con testo e copertina |
| Rifai da YouTube (R10) | API, MCP, CLI, UI `remake.spec`; incolla del link nella UI | Misurare il costo per video su una canzone reale | Costo in crediti scritto nel registro; e2e verde |
| Avvocato del diavolo (R10) | Esiste: `packages/remake/src/openrouter.ts`; obiezioni mostrate in `remake-card.tsx` | e2e che lo copre | e2e: accettare un'obiezione cambia il testo finale |
| Console interattiva (R10) | Da verificare | Inventario: cosa intendeva il proprietario a ottobre (sessione 15213305) e cosa esiste | Il proprietario la riconosce; e2e |
| Grafica fatta da Claude (R10) | Visualizzatore Remotion + Three.js, `art.ts` | Giuria grafica sul set d'oro (F2) | Giudizio cieco contro il video originale del link |
| Traduzione e adattamento culturale, cover (R11) | Traduzione nel remake | Verificare che la UI proponga lingua, cultura, melodia nuova o cover | e2e; giudizio cieco su 3 adattamenti |
| Immagini locali (R12) | `apps/worker/src/comfy/supervisor.ts`, `art.ts` | FLUX.2-klein locale contro immagini via abbonamento OpenAI (codex exec, gia usato da altri progetti del proprietario) | Giuria cieca su 10 copertine: costo e qualita per ciascuna strada |
| Agenti via CLI e MCP (R14) | Rilasciato 10/11 (`agent-remake-20261110-r1`); `packages/cli`, `apps/web/app/api/mcp/route.ts` | Una prova reale per agente: Claude Code, ChatGPT (connettore), Cursor | Ognuno avvia un remake e legge lo stato con il proprio abbonamento |
| Funzioni di ace-step-ui (R32) | Ispirazione presa a ottobre, elenco mai fatto | Elenco funzione per funzione di github.com/fspecii/ace-step-ui: c'e o manca nello studio | Ogni funzione presente o con motivo scritto per non farla; e2e per quelle presenti |
| HORIZONS 1ST.zip (R34) | Mai usato | Inventario del contenuto e decisione | Decisione scritta |
| Preset `I:\.YT STUFF` (R16) | Non inventariati | Inventario e mappa ai look del visualizzatore | Ogni preset usabile ha un look |
| Liquid glass e glassy-music (R18) | `glassy-ui.spec` | Nessuno salvo difetti dell'audit | Screenshot |
| Motori locali canzoni (R19) | ACE-Step, YuE via Comfy | Provare ACE-Step 1.5 (MIT) contro l'attuale | Giuria cieca su 5 canzoni |

Uscita di F1: un elenco di difetti ordinato; ogni difetto diventa un compito con test che fallisce prima.

**Stato 14/11 (autoresearch run 2, `E:/mellodifai/research/2026-11-14/autoresearch/f1-report.md`):** giudice congelato `apps/web/e2e/audit.spec.ts` + `ops/autoresearch/eval-f1.ts`; difetti reali 6 -> 4 (accettare l'obiezione dell'avvocato del diavolo; nome mancante nel modulo token; errore "S" del deploy, che eseguiva il deploy due volte). Restano R31 (in corso, con migrazione) e 3 falsi difetti audio del giudice (Web Audio non rilevato). Unito in `main` (`1c44f5f`).

## F2. Motore di miglioramento autoresearch (R15)

Il disegno M6 originale usava container Docker: non e piu possibile. Si adotta il metodo di Karpathy
(github.com/karpathy/autoresearch, MIT): un solo perimetro modificabile, un giudice congelato, un budget
fisso per esperimento, si tiene solo cio che migliora, il resto si annulla.

| Elemento | Scelta |
|---|---|
| `ops/autoresearch/program.md` | Istruzioni dell'agente (le scrive e le migliora il proprietario o il coordinatore, come in Karpathy) |
| Perimetro modificabile | Solo prompt di testi e immagini, look e preset del visualizzatore, parametri dei piani di taglio e delle inquadrature. Controllo dei percorsi: un diff fuori perimetro e scartato |
| Giudice congelato | `ops/autoresearch/eval.ts`, non modificabile dall'agente: set d'oro di 10 canzoni con provider finti; punteggio = giuria cieca (modello separato) + test verdi + costo stimato + tempo |
| Budget fisso | 10 minuti per esperimento sul laboratorio nativo (porte 45620-45629) |
| Registro | `results.tsv` non versionato: commit, punteggio, costo, stato keep/discard/crash, descrizione |
| Ramo | `autoresearch/<data>`; keep = avanza, discard = reset. Il merge in main resta un passo umano o del coordinatore con tutti i gate |
| Isolamento senza Docker | Worktree dedicato, stack di laboratorio, nessun file di segreti, provider finti; la giuria usa una chiave OpenRouter con tetto proprio |
| Quando | Di notte tramite Utilita di pianificazione (lanciatore gia pronto in `G:\claude-data\night`; serve `claude setup-token` del proprietario) |

Gia fatti 14/11: run 1 sul piano dei tagli (`ops/autoresearch/eval-cutplan.ts`, punteggio 0 -> 71,8, trovato il taglio di parole al fotogramma) e run 2 sull'audit F1 (sopra). Run 3 (19/11) fatto: giuria testi (R06) su set d'oro congelato di 32 testi in 3+ lingue (`ops/autoresearch/golden-lyrics/`, `eval-lyricjury.ts`), modello locale gemma4:e4b, accuratezza 84,4 -> 100, falsi promossi 5 -> 0 (report `E:/mellodifai/research/2026-11-19/autoresearch-lyricjury.md`); guadagno non ancora verificato sui giudici di produzione; il set e saturo e va ampliato prima del prossimo giro. Prossimo esperimento: preset e look del visualizzatore contro la giuria grafica. Giudice: punteggio medio della giuria cieca e zero regressioni nei test.

Anche questo piano segue il metodo: il giudice e `requisiti.md` (congelato), ogni versione del piano e
valutata da un critico cieco, si tiene la versione con punteggio piu alto (registro in
`E:/mellodifai/research/piano/results.tsv`).

## F3. Flusso video musicale AI (R20, R21, R22)

Dettaglio: `E:/mellodifai/research/2026-11-14/IMPROVED-research.md` e `GAUNTLET-PROMPT.md`.

| Gradino | Stato | Giudice |
|---|---|---|
| 1. Piano dei tagli, inquadrature, previz Three.js, audio come video nero, montaggio (gratis) | In corso (ramo `feat/music-video-line`) | Zero parole tagliate; durata video = audio entro 1 fotogramma; previz di una canzone vera |
| 2. Personaggio e set; bozze (locali Wan o Seedance draft via kie); lip sync; giuria prima del 1080p | Da fare dopo gradino 1 | Sfasamento labbiale max 2 fotogrammi; stessa faccia (SigLIP2); confronto cieco con il video del tutorial; max meta dei crediti di una generazione ingenua; totale entro 5000 |
| 2b. Struttura Cinema da Parallax (MIT): progetto > scene > inquadrature, elementi (personaggio, luogo, oggetto con riferimenti), compositore inquadratura -> prompt + riferimenti, take come generazioni | Da fare prima del gradino 3 (`E:/mellodifai/research/2026-11-14/parallax.md`, P1) | Il gradino 3 usa questo modello; una take si rigenera senza toccare le altre |
| 3. Linea completa dentro Rifai da YouTube, note sul fotogramma, rifare solo i pezzi segnati | Da fare | Un video finito da un link senza interventi; costo per minuto nel registro |

## F4. Pubblicazione e milestone pianificate (R13, R29)

**Stato 19/11:** in produzione `native-20261119-r2`: dashboard Pubblica solo YouTube (decisione del proprietario: altre piattaforme dopo, via Blotato o Postiz dietro `PublishingProvider`), veto, scheda di approvazione, regole fisse, comandi agenti (HTTP/MCP/CLI, guida `docs/agents-publishing.md`), metadati approvati inviati prima del pubblico. Ricerca e progetto: `E:/mellodifai/research/2026-11-19/`. Flusso video musicale (Cinema, previz, R31) anche in produzione; il gradino 2 a pagamento aspetta la ricarica kie. App desktop nativa su main (`2bcdfce`, tre giri di revisione cieca, isolata dalla produzione): installer `E:/mellodifai/dist/windows/MellodifAI-Setup-native-20261119-r2-43-g2bcdfce.exe`; canzoni e render restano spenti finche il proprietario non configura motore e Chrome propri.

| Voce | Stato | Prossimo passo | Giudice |
|---|---|---|---|
| YouTube | `publish.ts` programma (`scheduled`, `publish_at`) | Verificare in produzione | Video privato programmato e reso pubblico allo slot |
| Approvazione con prezzo per le chiamate a pagamento degli agenti (Parallax P2) | Assente: MCP e CLI avviano lavori pagati entro le riserve | Scheda con prezzo esatto che aspetta il si del proprietario, o regola automatica sotto una soglia | Test: chiamata pagata da agente resta in attesa finche non approvata; nessun addebito se rifiutata |
| Prezzo prima di ogni pulsante pagato e tetto giornaliero (Parallax P3) | Riserve in `quota.ts` | Mostrare il prezzo; un tetto giornaliero per tutta l'app | e2e: il prezzo appare; oltre il tetto la richiesta e rifiutata |
| Finestra di veto | Assente nel codice (nessun riferimento a "veto") | Costruirla come M4 la descrive | Test: un veto prima dello slot blocca la pubblicazione |
| Altri social (TikTok, Instagram, come Blotato) | Assente | Adattatori ufficiali per piattaforma, stessa finestra di veto | Pubblicazione di prova su account del proprietario solo con suo permesso |

Riconciliazione delle milestone del 03/11 (R29):

| Milestone e obiettivo scritto | Cosa esiste (14/11) | Cosa manca |
|---|---|---|
| M2a: remake R1-R4b, pause a testo e take, testo dall'agente via MCP, rifiuto di parafrasi troppo vicine, impronte della fonte | Remake via API, MCP, CLI rilasciato 10/11; `remake.spec` | Verificare il rifiuto delle parafrasi e la conservazione delle impronte dopo la cancellazione della fonte |
| M2b: master 1080p, Short 9:16, 3 copertine candidate, sottotitoli, scena modificabile dall'agente | Render e rerender (`rerender.spec`); clip verticale 9:16 (`db.ts` `aspect`, `video-card.tsx`); copertine e sottotitoli in `art.ts` e `publish.ts` | Il 9:16 come Short pubblicato con aggancio ("hook"), 3 candidati copertina, patch di scena da agente |
| M3: arte originale e leggibile per lingua, decisione di qualita per render | `render-quality.spec`, `qa.ts` | Decisione per render prima della pubblicazione: da verificare |
| M4: pacchetto per lingua, privato con veto, pubblicazione allo slot, analytics | Programmazione YouTube | Veto, pacchetto per lingua, analytics (nessun riferimento) |

Rilievi aperti delle revisioni del 03/11, da chiudere prima di costruire le parti mancanti:

| Rilievo | Correzione | Giudice |
|---|---|---|
| M2a:346 la giuria testi estesa e fail-closed, il design 10.1 la vuole com'e | Allineare piano e design su un solo comportamento | Test della giuria con giurato non disponibile |
| M2a:406 `web_tool_begin` accetta `p_items` dal chiamante senza prompt, durata e intento validati | Validare l'intento lato server | Test db: chiamata con elementi non validati rifiutata |
| M2a:23 caratteri rovinati nel titolo | Testo semplice | Lettura |
| M3:87 invio Midjourney scaduto: il router non vieta di ritentare | Vietare il nuovo invio finche lo stato e ambiguo | Test con invio scaduto: nessun doppio addebito |
| M3:134 si salvano tutte e quattro le uscite Midjourney oltre il limite di R6 | Salvare solo quelle ammesse | Test: numero di asset entro il limite |
| M4:96 il veto entra in conflitto appena la pubblicazione prende il lock | Definire l'ordine veto/lock e il recupero dopo crash | Test: veto un istante dopo il lock e crash a meta |

## F5. Debian VPS e installer Windows (R03, R04, R23)

| Voce | Stato | Prossimo passo | Giudice |
|---|---|---|---|
| Progetto Debian | Fatto e revisionato con EGM 14/11 (36 rilievi corretti) | Implementare i 19 compiti di `docs/superpowers/specs/2026-11-14-debian-vps-install-design.md` | shellcheck; test di deriva; installazione vera su Debian 13 in QEMU; riavvio; aggiornamento con secondo comando |
| Comando unico curl | Progettato | Dopo il primo test VM verde | Una VM vuota arriva a un'app funzionante con un solo comando |
| Accesso al repo privato | Azione del proprietario | Token di sola lettura o repo pubblico | Comando curl funziona |
| Motore canzoni esterno (`suno-remake`) | Fuori dal repo | Impacchettarlo dentro il progetto | Rifai da YouTube completo anche sul VPS |
| Installer Windows | Ramo `feat/local-launcher`, dipende da Docker | Spostarlo sul runtime nativo | Installa, avvia e aggiorna su un utente Windows pulito |

## F6. Migliorie misurate (R21, R22, R24, R28)

- Videohub nel video studio (R33). Incorporato finora: nulla (solo studiato il 14/11). Da incorporare, in ordine, ciascuno con il suo giudice: note legate alla versione con giro di verifica (e2e `rerender`), protezione risorse dei render (test con memoria simulata), render a pezzi (fotogrammi decodificati uguali al render completo), anteprima fotogramma (confronto anteprima/export), prova encoder (codice adattato da Videohub o HyperFrames con licenza; test con runner finto), copertine da fotogrammi, pulizia in quarantena. Il codice di Videohub che esegue i progetti senza isolamento non entra.
- Modalita demo senza chiavi (Parallax P4): ogni modello risponde con un file di esempio, attivabile dalla UI. Confronto prezzi e termini del gateway treg.to con kie (P6), nessun cambio senza un risparmio misurato.
- Modelli leggeri, ognuno solo dopo una prova misurata contro l'attuale: Qwen3-ASR e ForcedAligner (allineamento cantato), beat-this (tagli), Qwen3-VL-4B (giuria locale), SigLIP2 (identita), FLUX.2-klein (immagini), Wan 2.2 5B (bozze video).
- Cancelli di qualita: open-code-review su ogni ramo prima del merge; skill di Matt Pocock installate il 10/11 (software-factory per i piani, teach per i documenti) usate nei piani di fase; lint, test e flakiness sempre verdi.

Pulizia rami e worktree (R28), decisione per ciascuno:

| Ramo | Decisione |
|---|---|
| `feat/native-runtime` | Tenere fino al merge (F0), poi cancellare il worktree |
| `feat/music-video-line` | Tenere fino al merge del gradino 1 (F3) |
| `feat/local-launcher` | Tenere: va spostato sul runtime nativo (F5) |
| `feat/ace-step-native` | Confrontare con ACE-Step 1.5 (F1, R19); poi tenere le parti migliori o cancellare |
| `feat/perf` | Prendere solo i cambi con guadagno misurato, poi cancellare |
| `integrate/l2` | Cancellare dopo aver controllato che nulla manchi in `build/studio-ui` (il suo stack Docker non esiste piu) |
| `build/m1-agent-access` | Cancellare: gia unito; il worktree `.claude/worktrees/m1-agent-access` si rimuove solo dopo la conferma che il ledger M1 e archiviato |
| `build/studio-ui`, `main` | Restano. Il checkout principale `C:/Users/Asus/Documents/mellodifai` e su C:: contiene solo codice, ma test, cache e worktree si lanciano sempre da E: (`E:/mellodifai/wt/...`) |

## 7. Azioni del proprietario (R04, R27)

| Azione | Sblocca |
|---|---|
| Comando di logon nativo (una volta, dal runbook) | Avvio automatico della produzione |
| `claude setup-token` | Lavoro notturno autoresearch (F2) |
| Token GitHub di sola lettura o repo pubblico | Comando curl per Debian |
| VM Debian pubblica di prova, nome DNS e contatto ACME | Prova HTTPS pubblica dell'installer |
| Cloudflare Task 47 | Accesso pubblico al dominio |
| Chiave SMTP Resend | Email di accesso |
| Billing GitHub Actions | CI ospitata |
| Credenziali dei social e permesso per la prova | F4 |
| Prezzi kie verificati | Calcolo costi esatto |
| Codex trust degli hook TokenEconomizer | Risparmio token anche su Codex |
