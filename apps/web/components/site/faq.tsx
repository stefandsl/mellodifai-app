"use client";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useId, useState } from "react";
import { PlusGlyph } from "./icons";

// Questions and answers, one open at a time (the first at load). Each question is a button in a
// heading with aria-expanded and aria-controls; its answer is a region named by the question.
// A closed answer is inert, so it is neither read nor reached by Tab; its height folds to zero.
export function Faq({
  items,
  defaultOpen = 0,
  headingLevel = 3,
}: {
  items: readonly { q: string; a: string }[];
  defaultOpen?: number | null;
  headingLevel?: 2 | 3 | 4;
}) {
  const [open, setOpen] = useState<number | null>(defaultOpen);
  const base = useId();
  return (
    <VStack className="site-faq__list">
      {items.map((item, i) => {
        const isOpen = open === i;
        const q = `${base}q${i}`;
        const a = `${base}a${i}`;
        return (
          <VStack key={item.q} className="site-faq__item" data-open={isOpen}>
            <Heading level={headingLevel} className="site-faq__heading">
              <Button
                id={q}
                label={item.q}
                variant="ghost"
                width="100%"
                aria-expanded={isOpen}
                aria-controls={a}
                onClick={() => setOpen(isOpen ? null : i)}
                className="site-faq__trigger"
                endContent={
                  <Icon icon={PlusGlyph} size="sm" className="site-faq__icon" />
                }
              >
                <Text weight="medium" color="inherit" className="site-faq__q">
                  {item.q}
                </Text>
              </Button>
            </Heading>
            <VStack
              id={a}
              role="region"
              aria-labelledby={q}
              inert={!isOpen}
              className="site-faq__panel"
            >
              <VStack className="site-faq__fold">
                <Text as="p" color="secondary" className="site-faq__a">
                  {item.a}
                </Text>
              </VStack>
            </VStack>
          </VStack>
        );
      })}
    </VStack>
  );
}
