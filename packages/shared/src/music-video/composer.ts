// The composer: one storyboard shot, its elements and the project look -> one video-model
// prompt plus the ordered reference images. Pure and deterministic: the same input always
// gives the same prompt and the same references. The idea (sentence order, cast then location
// references, notes for what is left out) follows Parallax's Cinema composer
// (github.com/nickvasilescu/parallax docs/api/cinema.md, MIT); no Parallax code is copied. The
// wording follows the tutorial rules of rung 2 (bible.ts): genre first, images named by
// position, a single continuous shot without cuts, the camera, the exact lyrics.
import { BURST_CUTS, type Camera, type ShotKind } from "./shot-list.js";
import {
  CAMERA_FRAMING,
  type ElementKind,
  type MvLook,
  type ShotFraming,
} from "./storyboard.js";

export type ComposerElement = {
  id: string;
  kind: ElementKind;
  name: string;
  description: string;
  ref_asset_ids: string[];
};

export type ComposerShot = ShotFraming & {
  kind: ShotKind;
  burst: Camera[];
  mood: string;
  lyrics: string;
  cast_ids: string[];
  location_id: string | null;
};

export type ComposerProject = { genre: string; language: string; look: MvLook };

export type ComposedRef = {
  asset_id: string;
  element_id: string;
  label: string;
};

export type Composition = {
  prompt: string;
  images: ComposedRef[];
  // The reference video sent with the images: the black-picture song audio for sung shots,
  // the previz clip for instrumental ones.
  video: "song-audio" | "previz";
  notes: string[];
};

// Seedance 2.5 takes up to 30 reference images; the tutorial keeps a shot to a few, and every
// extra image weakens the identity of the first ones.
export const MAX_SHOT_IMAGES = 9;

const SIZE_TEXT: Record<ShotFraming["size"], string> = {
  "extreme-close-up": "extreme close-up on the singer's face",
  "close-up": "close-up on the singer's face and shoulders",
  "medium-close-up": "medium close-up of the singer from the chest up",
  medium: "medium shot of the singer from the waist up",
  wide: "wide shot of the whole set",
  "extreme-wide": "extreme wide shot of the whole place",
};
const ANGLE_TEXT: Record<ShotFraming["angle"], string> = {
  "eye-level": "",
  low: "from a low angle",
  high: "from a high angle",
  overhead: "from high overhead, looking down",
};
const MOVEMENT_TEXT: Record<ShotFraming["movement"], string> = {
  static: "the camera holds still",
  "push-in": "the camera slowly pushes in",
  "pull-out": "the camera slowly pulls out",
  dolly: "slow dolly move toward the singer",
  orbit: "the camera orbits around the singer",
  handheld: "handheld camera with a light natural sway",
  crane: "the camera rises on a crane",
};
// Sizes where the mouth fills enough of the frame for lip sync to read.
const CLOSE_SIZES = new Set<ShotFraming["size"]>([
  "extreme-close-up",
  "close-up",
  "medium-close-up",
]);

const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
const sentence = (s: string) => {
  const t = s.trim();
  if (!t) return "";
  return /[.!?]$/u.test(t) ? capital(t) : `${capital(t)}.`;
};

function framing(f: ShotFraming, lens: boolean): string {
  const size = [SIZE_TEXT[f.size], ANGLE_TEXT[f.angle]]
    .filter(Boolean)
    .join(" ");
  return [
    size,
    lens ? `${f.lens.replace("mm", " mm")} lens` : "",
    // A burst cut that holds still needs no camera words.
    !lens && f.movement === "static" ? "" : MOVEMENT_TEXT[f.movement],
  ]
    .filter(Boolean)
    .join(", ");
}

export function composeShot(
  shot: ComposerShot,
  elements: ComposerElement[],
  project: ComposerProject,
  options: { maxImages?: number } = {},
): Composition {
  const max = options.maxImages ?? MAX_SHOT_IMAGES;
  const notes: string[] = [];
  const byId = new Map(elements.map((e) => [e.id, e]));
  const cast: ComposerElement[] = [];
  for (const id of shot.cast_ids) {
    const e = byId.get(id);
    if (!e) notes.push(`cast ${id} is not an element of the project`);
    else if (e.kind === "location")
      notes.push(`${e.name} is a location, not cast`);
    else cast.push(e);
  }
  let location: ComposerElement | null = null;
  if (shot.location_id) {
    const e = byId.get(shot.location_id);
    if (!e) notes.push(`location ${shot.location_id} is not an element`);
    else if (e.kind !== "location") notes.push(`${e.name} is not a location`);
    else location = e;
  }

  // References: cast in cast order (each element's images in order), then the location;
  // repeated assets are sent once.
  const images: ComposedRef[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const e of [...cast, ...(location ? [location] : [])]) {
    let sent = 0;
    for (const asset of e.ref_asset_ids) {
      if (seen.has(asset)) continue;
      seen.add(asset);
      if (images.length >= max) {
        dropped++;
        continue;
      }
      images.push({
        asset_id: asset,
        element_id: e.id,
        label: sent++ === 0 ? e.name : `${e.name}, another view`,
      });
    }
  }
  if (dropped)
    notes.push(`${dropped} reference image(s) left out: the limit is ${max}`);

  const sung = shot.kind !== "instrumental-broll";
  const video = sung ? "song-audio" : "previz";
  const parts: string[] = [sentence(`${project.genre} music video`)];
  parts.push(...images.map((img, i) => `Image ${i + 1} is ${img.label}.`));
  const pictured = new Set(images.map((img) => img.element_id));
  if (video === "song-audio")
    parts.push(
      "Video 1 carries the song: use only its sound, ignore its black picture. The singer's lips follow its vocals exactly, syllable by syllable, from the first frame.",
    );
  else
    parts.push(
      "Video 1 is a grey-box 3D blocking of this shot: follow its camera path, framing and timing exactly, and replace its grey shapes with the real set and performer from the images.",
    );

  if (shot.kind === "burst") {
    const cuts = shot.burst.map((c) => framing(CAMERA_FRAMING[c], false));
    parts.push(
      `${BURST_CUTS} shots with different cuts in one take: first shot ${cuts[0] ?? framing(shot, false)}; then ${cuts.slice(1).join("; ")}. The singer dances to the beat between lines.`,
    );
  } else {
    parts.push("A single continuous shot without any cuts.");
    parts.push(sentence(framing(shot, true)));
    if (sung && CLOSE_SIZES.has(shot.size))
      parts.push("The mouth is clearly visible.");
  }

  // Elements without an image are described in words.
  const unseen = cast.filter((e) => !pictured.has(e.id));
  if (unseen.length)
    parts.push(
      `Featuring ${unseen
        .map((e) => (e.description ? `${e.name} (${e.description})` : e.name))
        .join("; ")}.`,
    );
  if (location && !pictured.has(location.id))
    parts.push(
      `Location: ${[location.name, location.description].filter(Boolean).join(", ")}.`,
    );
  if (shot.mood.trim()) parts.push(sentence(`Mood: ${shot.mood.trim()}`));
  const look = [project.look.style, project.look.grade, project.look.lighting]
    .map((s) => s.trim())
    .filter(Boolean);
  if (look.length) parts.push(sentence(`Look: ${look.join(", ")}`));

  if (sung)
    parts.push(
      `The singer sings exactly these ${project.language} lyrics, in order, and nothing else: "${shot.lyrics.trim().replace(/\n/gu, " / ")}"`,
    );
  else
    parts.push(
      "Instrumental passage: nobody sings, mouths stay closed, the performers move to the beat.",
    );
  if (sung && !shot.lyrics.trim()) notes.push("a sung shot without lyrics");
  parts.push("No text, no captions, no logos on screen.");
  return { prompt: parts.filter(Boolean).join(" "), images, video, notes };
}
