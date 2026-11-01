import {
  LICENCE_SHORT,
  licenceForbidsDerivatives,
  licenceNonCommercial,
  type SongSource,
  type SourceLicence,
} from "@mellodifai/shared";

import { type StudioKey, st, stf } from "./i18n";

export const LICENCE_LABEL: Record<SourceLicence, StudioKey> = {
  own: "lic.own",
  "cc-by": "lic.ccBy",
  "cc-by-sa": "lic.ccBySa",
  "cc-by-nc": "lic.ccByNc",
  "cc-by-nc-sa": "lic.ccByNcSa",
  "cc-by-nd": "lic.ccByNd",
  "cc-by-nc-nd": "lic.ccByNcNd",
  cc0: "lic.cc0",
  "public-domain": "lic.publicDomain",
  licensed: "lic.licensed",
  unknown: "lic.unknown",
};

const KIND_LABEL: Record<SongSource["kind"], StudioKey> = {
  suno: "src.kindSuno",
  upload: "src.kindUpload",
  cover: "src.kindCover",
  reference: "src.kindReference",
  extend: "src.kindExtend",
};

// The remix credit of a song made from other audio, as it goes under a video: "Cover di
// «Titolo» di Autore · CC BY 4.0". An imported song of the owner's own needs none.
export function creditLine(
  source: SongSource,
  lang: "it" | "en",
): string | null {
  if (
    (source.kind === "suno" || source.kind === "upload") &&
    source.licence === "own"
  )
    return null;
  const what = st(lang, KIND_LABEL[source.kind]);
  const title = source.title ? ` «${source.title}»` : "";
  const author = source.author
    ? stf(lang, "src.byAuthor", { author: source.author })
    : "";
  const licence = LICENCE_SHORT[source.licence];
  return [`${what}${title}${author}`, licence, source.url]
    .filter(Boolean)
    .join(" · ");
}

export function sourceKindLabel(lang: "it" | "en", kind: SongSource["kind"]) {
  return st(lang, KIND_LABEL[kind]);
}

// A warning the licence needs before the song is published, or null.
export function licenceWarning(
  lang: "it" | "en",
  source: SongSource,
): string | null {
  if (
    licenceForbidsDerivatives(source.licence) &&
    source.kind !== "suno" &&
    source.kind !== "upload"
  )
    return st(lang, "src.ndWarning");
  if (licenceNonCommercial(source.licence)) return st(lang, "src.ncWarning");
  if (source.licence === "unknown" && source.kind !== "suno")
    return st(lang, "src.unknownWarning");
  return null;
}
