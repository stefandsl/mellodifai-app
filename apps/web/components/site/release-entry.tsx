import { VStack } from "@astryxdesign/core/VStack";
import {
  type ComponentProps,
  type ComponentType,
  Fragment,
  type ReactNode,
} from "react";
import {
  type ChangelogEntry,
  formatChangelogDate,
  type MarkdownBlock,
  type MarkdownInline,
} from "@/lib/site/changelog-types";
import type { SiteLang } from "@/lib/site/copy";
import { SiteHeading, SiteLink, SiteText } from "@/src/site-primitives";

// @astryxdesign/core/VStack forwards standard HTML attributes at runtime,
// including `lang`, even though its public prop type omits `lang`.
const ReleaseBodyStack = VStack as ComponentType<
  ComponentProps<typeof VStack> & { lang?: string }
>;

function inlineKeyText(inlines: readonly MarkdownInline[]): string {
  return inlines
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.text;
        case "link":
          return `${n.label}:${n.href}`;
        case "strong":
        case "em":
          return inlineKeyText(n.children);
        default:
          return "";
      }
    })
    .join("");
}

function renderInlines(
  inlines: readonly MarkdownInline[],
  keyPrefix: string,
): ReactNode[] {
  const seen = new Map<string, number>();
  return inlines.map((node) => {
    const rawKey = `${keyPrefix}-${node.type}-${inlineKeyText([node]).slice(0, 32)}`;
    const count = seen.get(rawKey) ?? 0;
    seen.set(rawKey, count + 1);
    const key = count === 0 ? rawKey : `${rawKey}-${count}`;
    switch (node.type) {
      case "text":
        return <Fragment key={key}>{node.text}</Fragment>;
      case "strong":
        return (
          <strong key={key} className="site-release__strong">
            {renderInlines(node.children, `${key}-b`)}
          </strong>
        );
      case "em":
        return (
          <em key={key} className="site-release__em">
            {renderInlines(node.children, `${key}-i`)}
          </em>
        );
      case "code":
        return (
          <code key={key} className="site-release__code">
            {node.text}
          </code>
        );
      case "link": {
        const isExternal = /^https?:\/\//iu.test(node.href);
        return (
          <SiteLink
            key={key}
            href={node.href}
            color="accent"
            hasUnderline
            className="site-release__link"
            rel={isExternal ? "noopener noreferrer" : undefined}
          >
            {node.label}
          </SiteLink>
        );
      }
      default:
        return null;
    }
  });
}

function renderBlock(block: MarkdownBlock, keyPrefix: string): ReactNode {
  switch (block.type) {
    case "heading":
      return (
        <SiteHeading
          key={keyPrefix}
          level={block.level === 2 ? 3 : 4}
          className="site-release__subheading"
        >
          {renderInlines(block.inlines, `${keyPrefix}-h`)}
        </SiteHeading>
      );
    case "paragraph":
      return (
        <SiteText
          key={keyPrefix}
          as="p"
          color="secondary"
          className="site-release__para"
        >
          {renderInlines(block.inlines, `${keyPrefix}-p`)}
        </SiteText>
      );
    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      const seenItems = new Map<string, number>();
      return (
        <VStack
          key={keyPrefix}
          as={ListTag}
          gap={2}
          className={
            block.ordered
              ? "site-release__list site-release__list--ordered"
              : "site-release__list"
          }
        >
          {block.items.map((itemInlines) => {
            const baseKey = `${keyPrefix}-li-${inlineKeyText(itemInlines).slice(0, 48)}`;
            const count = seenItems.get(baseKey) ?? 0;
            seenItems.set(baseKey, count + 1);
            const itemKey = count === 0 ? baseKey : `${baseKey}-${count}`;
            return (
              <li key={itemKey} className="site-release__list-item">
                <SiteText color="secondary" className="site-release__list-text">
                  {renderInlines(itemInlines, itemKey)}
                </SiteText>
              </li>
            );
          })}
        </VStack>
      );
    }
    case "code":
      return (
        <pre key={keyPrefix} className="site-release__pre">
          <code className="site-release__pre-code">{block.text}</code>
        </pre>
      );
  }
}

export type ReleaseEntryProps = {
  entry: ChangelogEntry;
  lang: SiteLang;
  isFirstRefGrid?: boolean;
};

// One dated release row: sticky date + tag column left (220 px), gap 56 px, content column
// right (620 px) on wide viewports; date stacked over content at 390 px.
export function ReleaseEntry({
  entry,
  lang,
  isFirstRefGrid = false,
}: ReleaseEntryProps) {
  const formattedDate = formatChangelogDate(entry.isoDate, lang, "long");
  const headingText = entry.title ?? entry.tag;
  const headingId = `${entry.id}-title`;

  return (
    <VStack
      as="article"
      id={entry.id}
      className="site-release"
      data-release-entry={entry.id}
      data-release-tag={entry.tag}
      data-has-notes={entry.hasNotes ? "true" : "false"}
      aria-labelledby={headingId}
      {...(isFirstRefGrid
        ? { "data-ref-grid": "", "data-ref-grid-widths": "1440" }
        : {})}
    >
      <VStack className="site-release__meta" gap={2}>
        <time dateTime={entry.isoDate} className="site-release__date">
          {formattedDate}
        </time>
        <SiteText
          type="code"
          color="secondary"
          className="site-tag site-release__tag"
        >
          {entry.tag}
        </SiteText>
      </VStack>

      <ReleaseBodyStack
        className="site-release__body"
        gap={4}
        lang={lang !== "en" && entry.hasNotes ? "en" : undefined}
      >
        <SiteHeading level={2} id={headingId} className="site-release__title">
          {headingText}
        </SiteHeading>

        {entry.blocks.length > 0 ? (
          <VStack className="site-release__content" gap={4}>
            {(() => {
              const seenBlocks = new Map<string, number>();
              return entry.blocks.map((block) => {
                const raw = `${entry.id}-${block.type}-${
                  block.type === "code"
                    ? block.text.slice(0, 32)
                    : block.type === "list"
                      ? inlineKeyText(block.items[0] ?? []).slice(0, 32)
                      : inlineKeyText(block.inlines).slice(0, 32)
                }`;
                const count = seenBlocks.get(raw) ?? 0;
                seenBlocks.set(raw, count + 1);
                const key = count === 0 ? raw : `${raw}-${count}`;
                return renderBlock(block, key);
              });
            })()}
          </VStack>
        ) : null}
      </ReleaseBodyStack>
    </VStack>
  );
}
