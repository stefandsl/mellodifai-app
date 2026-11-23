import "@/components/site/recipes.css";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { Metadata } from "next";
import { Cover, type CoverKind } from "@/components/site/art";
import { ArrowGlyph } from "@/components/site/icons";
import {
  RecipesIndex,
  type RecipesViewMode,
} from "@/components/site/recipes-index";
import { getLocale } from "@/lib/locale";
import { SITE_COPY } from "@/lib/site/copy";
import { href } from "@/lib/site/nav";
import { getPublishedRecipes } from "@/lib/site/recipes";
import { getRecipeTestFixture } from "@/lib/site/recipes.fixture";

const CLOSING_ART: CoverKind[] = [
  "remix",
  "cover",
  "satire",
  "translation",
  "karaoke",
  "video",
];

// Recipes index (C05): default interactive canvas and server-rendered grid at ?view=grid.
// Uses the real C14 catalog loader (getPublishedRecipes). The 24-card test fixture is only
// reachable in lab/e2e runs (WORKER_FAKE=1) via ?fixture=24 for DOM-cap and grid-density judges.
export async function generateMetadata(): Promise<Metadata> {
  const copy = SITE_COPY[await getLocale()];
  return {
    title: copy.recipes.meta.title,
    description: copy.recipes.meta.description,
    alternates: {
      types: {
        "text/markdown": "/recipes.md",
      },
    },
  };
}

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; fixture?: string }>;
}) {
  const [locale, params] = await Promise.all([getLocale(), searchParams]);
  const copy = SITE_COPY[locale];
  const initialView: RecipesViewMode =
    params.view === "grid" ? "grid" : "canvas";
  const allowFixture =
    process.env.WORKER_FAKE === "1" && params.fixture === "24";
  const recipes = allowFixture ? getRecipeTestFixture() : getPublishedRecipes();

  const closingBand = (
    <VStack
      as="section"
      className="site-close"
      data-ref-section="2"
      aria-labelledby="recipes-close-title"
    >
      <VStack className="site-close__band">
        <HStack className="site-close__mosaic" aria-hidden="true">
          {CLOSING_ART.map((k) => (
            <Cover key={k} kind={k} className="site-close__cover" />
          ))}
        </HStack>
        <VStack
          className="site-close__column"
          data-ref-content
          gap={8}
          hAlign="center"
        >
          <Heading
            level={2}
            id="recipes-close-title"
            type="display-2"
            justify="center"
            className="site-close__title"
          >
            {copy.closing.title}
          </Heading>
          <Button
            label={copy.closing.action}
            href={href("start")}
            variant="primary"
            size="lg"
            icon={<Icon icon={ArrowGlyph} size="sm" color="inherit" />}
          />
          <Text type="supporting" color="secondary" justify="center">
            {copy.closing.note}
          </Text>
        </VStack>
      </VStack>
    </VStack>
  );

  return (
    <RecipesIndex
      recipes={recipes}
      initialView={initialView}
      fixtureParam={allowFixture ? "24" : undefined}
      lang={locale}
      copy={copy.recipes}
      closingBand={closingBand}
    />
  );
}
