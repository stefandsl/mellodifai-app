import { describe, expect, it } from "vitest";
import {
  type ComposerElement,
  type ComposerShot,
  composeShot,
} from "./composer.js";

const project = {
  genre: "Italo-disco",
  language: "Italian",
  look: { style: "35mm film", grade: "warm magenta and cyan", lighting: "" },
};
const singer: ComposerElement = {
  id: "costume-a",
  kind: "character",
  name: "the singer, wearing her office outfit",
  description: "an Italian woman in a navy blazer",
  ref_asset_ids: ["images/costume-a.png"],
};
const office: ComposerElement = {
  id: "set-verse",
  kind: "location",
  name: "the night office where she works",
  description: "open-plan office at night",
  ref_asset_ids: ["images/set-verse.png"],
};
const closeUp: ComposerShot = {
  kind: "lipsync-single",
  size: "close-up",
  angle: "eye-level",
  movement: "static",
  lens: "85mm",
  burst: [],
  mood: "intimate",
  lyrics: "va bene, passa\nnon guardo il codice",
  cast_ids: ["costume-a"],
  location_id: "set-verse",
};

describe("composeShot", () => {
  it("writes the rung 2 prompt for a sung close-up, references cast first", () => {
    const c = composeShot(closeUp, [office, singer], project);
    expect(c.prompt).toBe(
      [
        "Italo-disco music video.",
        "Image 1 is the singer, wearing her office outfit.",
        "Image 2 is the night office where she works.",
        "Video 1 carries the song: use only its sound, ignore its black picture. The singer's lips follow its vocals exactly, syllable by syllable, from the first frame.",
        "A single continuous shot without any cuts.",
        "Close-up on the singer's face and shoulders, 85 mm lens, the camera holds still.",
        "The mouth is clearly visible.",
        "Mood: intimate.",
        "Look: 35mm film, warm magenta and cyan.",
        'The singer sings exactly these Italian lyrics, in order, and nothing else: "va bene, passa / non guardo il codice"',
        "No text, no captions, no logos on screen.",
      ].join(" "),
    );
    expect(c.images).toEqual([
      {
        asset_id: "images/costume-a.png",
        element_id: "costume-a",
        label: "the singer, wearing her office outfit",
      },
      {
        asset_id: "images/set-verse.png",
        element_id: "set-verse",
        label: "the night office where she works",
      },
    ]);
    expect(c.video).toBe("song-audio");
    expect(c.notes).toEqual([]);
  });

  it("is deterministic", () => {
    expect(composeShot(closeUp, [singer, office], project)).toEqual(
      composeShot(closeUp, [singer, office], project),
    );
  });

  it("asks a burst for five cuts and never for a single continuous shot", () => {
    const c = composeShot(
      {
        ...closeUp,
        kind: "burst",
        size: "medium",
        movement: "orbit",
        lens: "35mm",
        burst: ["orbit", "close-up", "medium", "overhead", "dolly"],
      },
      [singer, office],
      project,
    );
    expect(c.prompt).toContain(
      "5 shots with different cuts in one take: first shot medium shot of the singer from the waist up, the camera orbits around the singer; then close-up on the singer's face and shoulders; medium shot of the singer from the waist up;",
    );
    expect(c.prompt).not.toContain("single continuous");
    expect(c.prompt).toContain('"va bene, passa / non guardo il codice"');
  });

  it("gives instrumental b-roll the previz video and closed mouths", () => {
    const c = composeShot(
      {
        ...closeUp,
        kind: "instrumental-broll",
        size: "wide",
        angle: "overhead",
        lens: "24mm",
        lyrics: "",
      },
      [singer, office],
      project,
    );
    expect(c.video).toBe("previz");
    expect(c.prompt).toContain("Video 1 is a grey-box 3D blocking");
    expect(c.prompt).toContain(
      "Wide shot of the whole set from high overhead, looking down, 24 mm lens, the camera holds still.",
    );
    expect(c.prompt).toContain("nobody sings, mouths stay closed");
    expect(c.prompt).not.toContain("sings exactly");
    expect(c.prompt).not.toContain("mouth is clearly visible");
  });

  it("describes elements without images in words and skips repeated or extra images", () => {
    const prop: ComposerElement = {
      id: "badge",
      kind: "prop",
      name: "a red lanyard",
      description: "with a plastic ID badge",
      ref_asset_ids: [],
    };
    const twin: ComposerElement = {
      ...singer,
      id: "twin",
      name: "her twin",
      ref_asset_ids: [
        "images/costume-a.png",
        "images/twin.png",
        "images/x.png",
      ],
    };
    const c = composeShot(
      { ...closeUp, cast_ids: ["costume-a", "badge", "twin"] },
      [singer, prop, twin, office],
      project,
      { maxImages: 3 },
    );
    expect(c.images.map((i) => i.asset_id)).toEqual([
      "images/costume-a.png",
      "images/twin.png",
      "images/x.png",
    ]);
    expect(c.images[1]?.label).toBe("her twin");
    expect(c.images[2]?.label).toBe("her twin, another view");
    expect(c.prompt).toContain(
      "Featuring a red lanyard (with a plastic ID badge).",
    );
    expect(c.prompt).toContain(
      "Location: the night office where she works, open-plan office at night.",
    );
    expect(c.notes).toEqual(["1 reference image(s) left out: the limit is 3"]);
  });

  it("notes a location in the cast, a missing element and a sung shot without lyrics", () => {
    const c = composeShot(
      {
        ...closeUp,
        cast_ids: ["set-verse", "ghost"],
        location_id: "costume-a",
        lyrics: " ",
      },
      [singer, office],
      project,
    );
    expect(c.images).toEqual([]);
    expect(c.notes).toEqual([
      "the night office where she works is a location, not cast",
      "cast ghost is not an element of the project",
      "the singer, wearing her office outfit is not a location",
      "a sung shot without lyrics",
    ]);
  });
});
