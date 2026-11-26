import type { RecipeInput } from "@mellodifai/shared";
import type { SiteCopy, SiteLang } from "./copy";
import type { LoadedRecipe } from "./recipes";

export const CLIP_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export const CLIP_HERO_IMAGE_SIZES = "(max-width: 767px) 94vw, 980px";
export const MORE_CARD_IMAGE_SIZES = "391px";

export function isVideoFile(filename: string): boolean {
  return filename.toLowerCase().endsWith(".mp4");
}

export function formatClipTime(seconds: number): string {
  const safe =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function buildClipCaptionDataUri(title: string, line: string): string {
  const cleanTitle = title.replaceAll(/[\r\n]+/gu, " ").trim();
  const cleanLine = line.replaceAll(/[\r\n]+/gu, " ").trim();
  const vtt = [
    "WEBVTT",
    "",
    "00:00.000 --> 00:30.000",
    cleanLine || cleanTitle,
    "",
  ].join("\n");
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`;
}

export type RecipeMetaItem = { key: string; text: string };

export function formatRecipeMeta(
  recipe: LoadedRecipe,
  copy: SiteCopy["recipeDetail"],
): RecipeMetaItem[] {
  const items: RecipeMetaItem[] = [];
  items.push({ key: "genre", text: recipe.genre });
  items.push({
    key: "languages",
    text: recipe.languages.map((l) => l.toUpperCase()).join(" / "),
  });
  const outputLabel = copy.outputs[recipe.output];
  items.push({
    key: "output",
    text: recipe.format ? `${outputLabel} ${recipe.format}` : outputLabel,
  });
  items.push({
    key: "length",
    text: `${copy.forms[recipe.form]} (${formatClipTime(recipe.estimate.seconds)})`,
  });
  if (recipe.tempo?.bpm) {
    items.push({ key: "tempo", text: `${recipe.tempo.bpm} BPM` });
  }
  const voiceKey = recipe.preset.vocalGender ?? "any";
  items.push({ key: "voice", text: copy.voices[voiceKey] });
  return items;
}

export function formatInputLimit(
  input: RecipeInput,
  copy: SiteCopy["recipeDetail"],
): string {
  const parts: string[] = [];
  parts.push(input.optional ? copy.inputOptional : copy.inputRequired);
  if (input.kind === "audio") {
    parts.push(copy.inputAudioLimit);
  } else if (input.kind === "select") {
    parts.push(
      copy.inputOptionsLimit.replace("{n}", String(input.options.length)),
    );
  } else if ("maxLength" in input && typeof input.maxLength === "number") {
    parts.push(copy.inputCharsLimit.replace("{n}", String(input.maxLength)));
  }
  return parts.join(" · ");
}

export function formatInputHint(
  input: RecipeInput,
  lang: SiteLang,
  copy: SiteCopy["recipeDetail"],
): string {
  if (input.hint?.[lang]) return input.hint[lang];
  if (input.placeholder?.[lang]) return input.placeholder[lang];
  return copy.inputDefaultHints[input.kind];
}
