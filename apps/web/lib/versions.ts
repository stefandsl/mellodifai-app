import { LANGS } from "@mellodifai/shared";

export function orderedVersions<T extends { lang: string }>(
  versions: readonly T[],
): T[] {
  return LANGS.flatMap((lang) =>
    versions.filter((version) => version.lang === lang),
  );
}

export function selectedVersion<T extends { lang: string }>(
  versions: readonly T[],
  language?: string,
): T | undefined {
  return (
    versions.find((version) => version.lang === language) ??
    orderedVersions(versions)[0]
  );
}
