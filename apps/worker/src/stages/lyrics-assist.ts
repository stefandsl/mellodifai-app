// The create panel's AI lyric buttons (task 27), on the worker's lyric pipeline: the router picks
// the writer for a new song, the fast or strong writer writes, the same jury as the song drafts
// scores the result and one revision follows when it fails. The job has no song; its request and
// result live in lyric_requests.
import {
  type LANGS,
  type LyricsAssistInput,
  LyricsAssistInputSchema,
  type LyricsAssistResult,
  LyricsAssistResultSchema,
  spliceSection,
} from "@mellodifai/shared";
import type { SonglessHandler } from "../loop.js";
import { openRouterCall, openRouterRequest } from "../providers/openrouter.js";
import {
  DEFAULT_JUDGES,
  DEFAULT_WRITERS,
  type JuryReport,
  judge,
  looksRedacted,
  lyricsBudget,
  PASS_SCORE,
  REDACTION_NOTE,
  revisionBrief,
  route,
  toneLine,
  type Writer,
} from "./lyric-jury.js";

const LANGUAGE: Record<(typeof LANGS)[number], string> = {
  it: "Italian",
  ru: "Russian",
  ro: "Romanian",
  ja: "Japanese",
  en: "English",
  es: "Spanish",
  de: "German",
  zh: "Chinese",
  pt: "Portuguese",
  ko: "Korean",
  fr: "French",
};

export class LyricsRedacted extends Error {
  constructor() {
    super(
      "OpenRouter's privacy filter replaced words of the lyrics with tags such as [PERSON_NAME]; turn the filter off in OpenRouter settings (Privacy)",
    );
    this.name = "LyricsRedacted";
  }
}

const MAX_CALLS = 2;
const EM_DASH = new RegExp(String.fromCodePoint(0x2014, 0x2013), "gu");

function sectionOf(input: LyricsAssistInput) {
  return input.mode === "regenerate" && input.section
    ? input.lyrics.slice(input.section.start, input.section.end).trim()
    : null;
}

export function assistSystem(input: LyricsAssistInput): string {
  const section = sectionOf(input);
  const task =
    input.mode === "write"
      ? "Write an original song from the title, brief and styles the user gives."
      : input.mode === "improve"
        ? "Improve the user's song without changing its meaning, story, language or section structure: steady meter (comparable syllable counts within a section), stronger and more natural rhymes, a catchier chorus, natural wording. Change only what needs it and keep every section tag."
        : section
          ? 'Rewrite only the section marked TO REWRITE: new lines with the same role, about the same number of lines and syllables, consistent with the rest of the song. Reply with {"title": null, "lyrics": the rewritten section starting with its [Tag] line}.'
          : "Write a new version of the user's song: same subject, language and section structure, new lines and new images; do not reuse its lines.";
  return [
    "ROLE: songwriter of the MellodifAI studio.",
    task,
    `Write singable, natural, idiomatic ${LANGUAGE[input.lang]}.`,
    "Put each section tag in square brackets on its own line ([Verse 1], [Pre-Chorus], [Chorus], [Bridge], [Outro]); a new song has two or three verses and a chorus that comes back, about 16 to 40 sung lines.",
    "No artist, song or brand names, nothing unsafe for YouTube. Never use the em dash character.",
    REDACTION_NOTE,
    'Reply with one JSON object only: {"title": string, "lyrics": string}.',
  ].join("\n");
}

export function assistUser(
  input: LyricsAssistInput,
  tone: string,
  correction: string,
): string {
  const section = sectionOf(input);
  return [
    `Language: ${LANGUAGE[input.lang]}`,
    input.title.trim() ? `Title: ${input.title.trim()}` : "",
    input.brief.trim() ? `Brief: ${input.brief.trim()}` : "",
    input.style.trim() ? `Styles: ${input.style.trim()}` : "",
    input.vocalGender ? `Vocal gender: ${input.vocalGender}` : "",
    tone,
    input.mode === "write"
      ? ""
      : section
        ? `Whole song for context:\n${input.lyrics}\n\nTO REWRITE:\n${section}`
        : `The song:\n${input.lyrics}`,
    correction,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseReply(content: string): { title: string | null; lyrics: string } {
  const json = content
    .trim()
    .replace(/^```(?:json)?\s*/u, "")
    .replace(/\s*```$/u, "");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    const start = json.indexOf("{");
    const end = json.lastIndexOf("}");
    value =
      start >= 0 && end > start ? JSON.parse(json.slice(start, end + 1)) : {};
  }
  const o = (value ?? {}) as { title?: unknown; lyrics?: unknown };
  return {
    title:
      typeof o.title === "string" && o.title.trim()
        ? o.title.trim().replace(EM_DASH, "-").slice(0, 100)
        : null,
    lyrics:
      typeof o.lyrics === "string" ? o.lyrics.replace(EM_DASH, "-").trim() : "",
  };
}

export const lyricsAssist: SonglessHandler = async (context) => {
  const requestId = String(context.job.payload?.request_id ?? "");
  const request = await context.db.getLyricRequest(requestId);
  if (!request) throw new Error("lyrics request not found");
  try {
    const input = LyricsAssistInputSchema.parse({
      ...(request.input as Record<string, unknown>),
      mode: request.mode,
      lang: request.lang,
    });
    const secrets = context.secrets.values;
    const budget = await lyricsBudget(secrets);
    const call = openRouterCall(context);
    const writers = {
      strong: secrets.LYRICS_MODEL_STRONG ?? DEFAULT_WRITERS.strong,
      fast: secrets.LYRICS_MODEL_FAST ?? DEFAULT_WRITERS.fast,
    };
    const judges = secrets.LYRICS_JUDGES
      ? secrets.LYRICS_JUDGES.split(",").map((model) => model.trim())
      : DEFAULT_JUDGES;
    const passScore = Number(secrets.LYRICS_JURY_PASS ?? PASS_SCORE);
    const juryOn = secrets.LYRICS_JURY !== "off";
    const started = performance.now();
    const topic =
      input.title.trim() ||
      input.brief.trim() ||
      (input.mode === "write"
        ? input.style.trim()
        : "the subject of the user's song");

    await context.progress(5, "assist.route");
    // A new song: the router reads the request (tone, writer). Editing an existing text keeps
    // its tone, and the fast writer handles it.
    const plan =
      input.mode === "write" && juryOn
        ? await route(
            {
              topic,
              brief: input.brief,
              style: input.style,
              lang: input.lang,
            },
            call,
          )
        : { tone: null, writer: "fast" as Writer };
    let writer: Writer = plan.writer;
    let correction = "";
    let best: { result: LyricsAssistResult; jury: JuryReport } | undefined;
    for (let calls = 0; calls < MAX_CALLS; calls++) {
      await budget.reserve();
      await context.progress(
        calls === 0 ? 20 : 60,
        calls === 0 ? "assist.write" : "assist.revise",
      );
      const response = await openRouterRequest(
        "chat",
        {
          model: writers[writer],
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: assistSystem(input) },
            {
              role: "user",
              content: assistUser(input, toneLine(plan.tone), correction),
            },
          ],
        },
        call,
      );
      if (!response.ok)
        throw new Error(`OpenRouter request failed: ${response.status}`);
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const reply = parseReply(body.choices?.[0]?.message?.content ?? "");
      if (!reply.lyrics) {
        correction =
          'Your reply had no lyrics. Reply with one JSON object only: {"title": string, "lyrics": string}.';
        continue;
      }
      // A writer that read tags instead of words wrote around them: never hand that back.
      if (looksRedacted(reply.lyrics, reply.title ?? ""))
        throw new LyricsRedacted();
      const lyrics = input.section
        ? spliceSection(input.lyrics, input.section, reply.lyrics)
        : reply.lyrics;
      await context.progress(calls === 0 ? 45 : 80, "assist.jury");
      const jury = juryOn
        ? await judge(
            { title: reply.title ?? input.title, lyrics, style: input.style },
            {
              topic,
              lang: input.lang,
              referenceTitle: "",
              brief: input.brief.trim(),
              // A new version of the whole song must not reuse its lines; the writer read them.
              referenceLyrics:
                input.mode === "regenerate" && !input.section
                  ? input.lyrics
                  : "",
            },
            judges,
            call,
            passScore,
          )
        : undefined;
      const result: LyricsAssistResult = LyricsAssistResultSchema.parse({
        lyrics,
        title: input.mode === "write" ? reply.title : null,
        jury: {
          available: jury?.available ?? false,
          passed: jury?.passed ?? true,
          scores: jury?.scores ?? {},
          issues: jury?.issues ?? [],
          redacted: jury?.redacted ?? false,
        },
        writer: writers[writer],
        ms: Math.round(performance.now() - started),
      });
      const score = (r: JuryReport | undefined) =>
        Math.min(1, ...Object.values(r?.scores ?? {}));
      if (!best || result.jury.passed || score(jury) > score(best.jury))
        best = { result, jury: jury ?? ({} as JuryReport) };
      if (!jury || jury.passed || !jury.available) break;
      writer = jury.improver;
      correction = `${revisionBrief(jury)}\nPrevious version:\n${reply.lyrics}`;
    }
    if (!best) throw new Error("the writer returned no lyrics");
    await context.db.patchLyricRequest(request.id, {
      result: best.result,
      error_code: null,
    });
    await context.progress(100, "assist.done");
    return {};
  } catch (error) {
    if (!context.signal.aborted)
      await context.db.patchLyricRequest(request.id, {
        error_code:
          error instanceof LyricsRedacted
            ? "privacy_filter"
            : /daily lyrics cap/u.test(String(error))
              ? "limit"
              : "failed",
      });
    throw error;
  }
};
