import { HStack } from "@astryxdesign/core/HStack";
import { SiteLink, SiteText } from "@/src/site-primitives";

// The logo file is pure red; the mark is painted through it in the brand ember token, so the
// logo and the accent word of the hero are one red family.
export function Brand({
  label,
  size = "header",
}: {
  label: string;
  size?: "header" | "footer";
}) {
  return (
    <SiteLink
      href="/"
      label={label}
      color="inherit"
      className={`site-brand site-brand--${size}`}
    >
      <HStack as="span" gap={2} align="center">
        <HStack as="span" className="site-brand__mark" aria-hidden="true" />
        <SiteText className="site-brand__name" color="inherit">
          MellodifAI
        </SiteText>
      </HStack>
    </SiteLink>
  );
}
