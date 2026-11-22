import { HStack } from "@astryxdesign/core/HStack";
import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";

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
    <Link
      href="/"
      label={label}
      color="inherit"
      className={`site-brand site-brand--${size}`}
    >
      <HStack as="span" gap={2} align="center">
        <HStack as="span" className="site-brand__mark" aria-hidden="true" />
        <Text className="site-brand__name" color="inherit">
          MellodifAI
        </Text>
      </HStack>
    </Link>
  );
}
