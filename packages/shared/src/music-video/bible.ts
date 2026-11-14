// Prompts for the performer bible, the set bible and the generation of one shot, following the
// workflow in research/2026-11-14/video-workflow.md: one performer image, costume variants by
// reference edit ("change only the outfit"), linked sets (the chorus set contains the verse set),
// and per shot the genre, "a single continuous shot without cuts" for single shots, the camera
// and the exact lyrics of the segment.
import type { Camera, Shot } from "./shot-list.js";
import { BURST_CUTS } from "./shot-list.js";

export type SongBrief = {
  title: string;
  language: string;
  genre: string;
  // One or two sentences on what the song is about, in English.
  story: string;
};

export type Costume = { id: string; outfit: string };
export type SetDesign = { id: string; description: string };

export type Bible = {
  performer: { prompt: string };
  costumes: { base: Costume; variants: (Costume & { prompt: string })[] };
  sets: { id: string; prompt: string; containsSet?: string }[];
};

// Everything a prompt says about the performer's face and body, so every image and video asks
// for the same person.
export const PERFORMER_FACE =
  "an Italian woman in her early thirties, olive skin, dark brown eyes, thick dark eyebrows, a small mole above the left corner of her lips, shoulder-length wavy dark brown hair with a straight fringe, an ironic half-smile";

export function performerPrompt(song: SongBrief, base: Costume): string {
  return [
    `Photorealistic full-body character portrait of the lead singer of an ${song.genre} music video for the ${song.language} song "${song.title}": ${song.story}`,
    `She is ${PERFORMER_FACE}.`,
    `Outfit: ${base.outfit}.`,
    "Standing, facing the camera, arms relaxed, whole body visible from head to shoes, neutral light-grey studio background, soft even studio light, sharp focus on the face, 50 mm lens, no text, no logos.",
  ].join(" ");
}

export function costumePrompt(variant: Costume): string {
  return [
    "Change only the outfit of the woman in the reference image.",
    `New outfit: ${variant.outfit}.`,
    "Keep exactly the same face, hair, skin, body, pose, framing, background and light. No text, no logos.",
  ].join(" ");
}

export function setPrompt(set: SetDesign, contains?: SetDesign): string {
  const parts = [
    `Photorealistic empty film set for a music video, wide establishing view, no people: ${set.description}`,
  ];
  if (contains)
    parts.push(
      `The place in the reference image (${contains.id}) is part of this set: ${contains.description.split(".")[0]} must stay recognisable inside it, so a camera can move from one to the other.`,
    );
  parts.push("Cinematic light, 16:9, no text, no logos.");
  return parts.join(" ");
}

export function bibleFor(
  song: SongBrief,
  base: Costume,
  variants: Costume[],
  verse: SetDesign,
  chorus: SetDesign,
): Bible {
  return {
    performer: { prompt: performerPrompt(song, base) },
    costumes: {
      base,
      variants: variants.map((v) => ({ ...v, prompt: costumePrompt(v) })),
    },
    sets: [
      { id: verse.id, prompt: setPrompt(verse) },
      {
        id: chorus.id,
        prompt: setPrompt(chorus, verse),
        containsSet: verse.id,
      },
    ],
  };
}

const CAMERA_TEXT: Record<Camera, string> = {
  "close-up":
    "close-up on the singer's face and shoulders, the mouth clearly visible",
  medium: "medium shot of the singer from the waist up",
  wide: "wide shot of the whole set",
  overhead: "high overhead shot looking down",
  orbit: "the camera orbits around the singer",
  dolly: "slow dolly move toward the singer",
};

export type ShotRefs = {
  // Order in which the images are sent; the prompt names them by position.
  images: { role: "performer" | "set"; label: string }[];
  // The black-picture audio video (sung shots) or the previz clip (camera reference).
  video?: "song-audio" | "previz";
};

// The prompt of one generation. Lyrics are quoted exactly, line by line.
export function generationPrompt(
  shot: Pick<Shot, "kind" | "camera" | "burst" | "lyrics">,
  genre: string,
  refs: ShotRefs,
): string {
  const named = refs.images
    .map((img, i) => `Image ${i + 1} is ${img.label}.`)
    .join(" ");
  const parts = [`${genre} music video.`, named];
  if (refs.video === "song-audio")
    parts.push(
      "Video 1 carries the song: use only its sound, ignore its black picture. The singer's lips follow its vocals exactly, syllable by syllable, from the first frame.",
    );
  if (refs.video === "previz")
    parts.push(
      "Video 1 is a grey-box 3D blocking of this shot: follow its camera path, framing and timing exactly, and replace its grey shapes with the real set and performer from the images.",
    );
  if (shot.kind === "burst") {
    parts.push(
      `${BURST_CUTS} shots with different cuts in one take: first shot ${CAMERA_TEXT[shot.camera]}; then ${shot.burst
        .slice(1)
        .map((c) => CAMERA_TEXT[c])
        .join("; ")}. She dances to the beat between lines.`,
    );
  } else {
    parts.push("A single continuous shot without any cuts.");
    const camera = CAMERA_TEXT[shot.camera];
    parts.push(`${camera.charAt(0).toUpperCase()}${camera.slice(1)}.`);
  }
  if (shot.kind === "instrumental-broll")
    parts.push(
      "Instrumental passage: nobody sings, her mouth stays closed, she moves to the beat.",
    );
  else
    parts.push(
      `She sings exactly these Italian lyrics, in order, and nothing else: "${shot.lyrics.replace(/\n/gu, " / ")}"`,
    );
  parts.push("No text, no captions, no logos on screen.");
  return parts.join(" ");
}
