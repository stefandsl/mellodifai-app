import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TopNav, TopNavItem } from "@astryxdesign/core/TopNav";
import type { ReactElement, SVGProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SiteButtonLink,
  SiteHeading,
  SiteIcon,
  SiteLink,
  SiteText,
  SiteTopNav,
  SiteTopNavItem,
} from "@/src/site-primitives";
import {
  SiteTable,
  SiteTableBody,
  SiteTableCell,
  SiteTableHeader,
  SiteTableHeaderCell,
  SiteTableRow,
} from "@/src/site-table-primitives";

function TestSvg(props: SVGProps<SVGSVGElement>) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: a11y attributes are supplied by Icon / SiteIcon via props
    <svg viewBox="0 0 16 16" {...props}>
      <path d="M2 8h12" />
    </svg>
  );
}

function parseRoot(element: ReactElement): Element {
  const html = renderToStaticMarkup(element);
  const doc = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    "text/html",
  );
  const root = doc.body.firstElementChild;
  if (!root) throw new Error(`Empty markup rendered: ${html}`);
  return root;
}

function classListOf(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/u).filter(Boolean).sort();
}

function a11yAttrsOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (
      attr.name === "role" ||
      attr.name === "tabindex" ||
      attr.name.startsWith("aria-")
    ) {
      out[attr.name] = attr.value;
    }
  }
  return out;
}

function dataAttrsOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith("data-")) {
      out[attr.name] = attr.value;
    }
  }
  return out;
}

function assertElementParity(
  siteEl: Element,
  astryxEl: Element,
  label: string,
  options?: {
    ignoreDataAttrs?: string[];
    ignoreA11yAttrs?: string[];
  },
) {
  expect(siteEl.tagName, `${label} tagName`).toBe(astryxEl.tagName);
  expect(classListOf(siteEl), `${label} classes`).toEqual(
    classListOf(astryxEl),
  );

  const siteA11y = a11yAttrsOf(siteEl);
  const astryxA11y = a11yAttrsOf(astryxEl);
  for (const key of options?.ignoreA11yAttrs ?? []) {
    delete siteA11y[key];
    delete astryxA11y[key];
  }
  expect(siteA11y, `${label} a11y attributes`).toEqual(astryxA11y);

  const siteData = dataAttrsOf(siteEl);
  const astryxData = dataAttrsOf(astryxEl);
  for (const key of options?.ignoreDataAttrs ?? []) {
    delete siteData[key];
    delete astryxData[key];
  }
  expect(siteData, `${label} data attributes`).toEqual(astryxData);
}

describe("server-safe site primitives match real Astryx SSR output", () => {
  it("SiteText matches Text across types, weights, sizes, colors and clamping", () => {
    const cases = [
      { props: {}, text: "Default body" },
      {
        props: {
          as: "p" as const,
          type: "supporting" as const,
          color: "secondary" as const,
        },
        text: "Supporting",
      },
      {
        props: {
          type: "label" as const,
          weight: "semibold" as const,
          size: "sm" as const,
        },
        text: "Label",
      },
      {
        props: {
          type: "large" as const,
          display: "block" as const,
          justify: "center" as const,
        },
        text: "Centered",
      },
      { props: { type: "code" as const, maxLines: 1 }, text: "Single line" },
      { props: { maxLines: 2 }, text: "Two lines" },
    ];
    for (const c of cases) {
      const siteRoot = parseRoot(<SiteText {...c.props}>{c.text}</SiteText>);
      const astryxRoot = parseRoot(<Text {...c.props}>{c.text}</Text>);
      assertElementParity(siteRoot, astryxRoot, `Text(${c.text})`);
    }
  });

  it("SiteHeading matches Heading across levels, display types and weights", () => {
    const cases = [
      { level: 1 as const, type: "display-1" as const },
      { level: 2 as const, type: "display-2" as const },
      { level: 2 as const, weight: "medium" as const },
      { level: 3 as const, color: "secondary" as const },
      { level: 4 as const, maxLines: 1 },
    ];
    for (const c of cases) {
      const siteRoot = parseRoot(<SiteHeading {...c}>Title</SiteHeading>);
      const astryxRoot = parseRoot(<Heading {...c}>Title</Heading>);
      assertElementParity(siteRoot, astryxRoot, `Heading(L${c.level})`);
    }
  });

  it("SiteLink matches Link across colors, underline, label and inner Text", () => {
    const cases = [
      { href: "/pricing" },
      { href: "/pricing", color: "primary" as const, hasUnderline: true },
      { href: "/pricing", color: "secondary" as const, label: "View plans" },
      {
        href: "/",
        color: "inherit" as const,
        type: "supporting" as const,
        weight: "medium" as const,
      },
    ];
    for (const c of cases) {
      const siteRoot = parseRoot(<SiteLink {...c}>Plans</SiteLink>);
      const astryxRoot = parseRoot(<Link {...c}>Plans</Link>);
      assertElementParity(
        siteRoot,
        astryxRoot,
        `Link(${c.color ?? "default"})`,
        {
          ignoreDataAttrs: ["data-astryx-pressable"],
        },
      );
      const siteLabel = siteRoot.firstElementChild;
      const astryxLabel = astryxRoot.firstElementChild;
      expect(siteLabel).not.toBeNull();
      expect(astryxLabel).not.toBeNull();
      if (siteLabel && astryxLabel) {
        assertElementParity(
          siteLabel,
          astryxLabel,
          `Link inner Text(${c.color ?? "default"})`,
        );
      }
    }
  });

  it("SiteButtonLink matches Button(href) across variants, sizes, width, icon and aria-label", () => {
    const cases = [
      { href: "/create", label: "Start a song", variant: "primary" as const },
      { href: "/login", label: "Log in", variant: "secondary" as const },
      {
        href: "/pricing",
        label: "Compare plans",
        variant: "ghost" as const,
        size: "sm" as const,
      },
      {
        href: "/create",
        label: "Start",
        variant: "primary" as const,
        size: "lg" as const,
        width: "100%",
      },
      {
        href: "/create",
        label: "Start with icon",
        variant: "secondary" as const,
        icon: <TestSvg aria-hidden="true" />,
      },
      {
        href: "/create",
        label: "Accessible label",
        variant: "secondary" as const,
        children: "Visible text",
      },
    ];
    for (const c of cases) {
      const siteRoot = parseRoot(<SiteButtonLink {...c} />);
      const astryxRoot = parseRoot(<Button {...c} />);
      assertElementParity(
        siteRoot,
        astryxRoot,
        `ButtonLink(${c.variant}/${c.size ?? "md"}/${c.label})`,
        {
          ignoreDataAttrs: ["data-astryx-pressable"],
        },
      );

      // Content wrapper span
      const siteContent = siteRoot.children[0];
      const astryxContent = astryxRoot.children[0];
      expect(siteContent).toBeDefined();
      expect(astryxContent).toBeDefined();
      assertElementParity(
        siteContent,
        astryxContent,
        `ButtonLink contentWrapper(${c.label})`,
      );

      // Children inside content wrapper (optional icon wrapper + label span)
      expect(siteContent.children.length).toBe(astryxContent.children.length);
      for (let i = 0; i < siteContent.children.length; i++) {
        const isLabelSpan = i === siteContent.children.length - 1;
        assertElementParity(
          siteContent.children[i],
          astryxContent.children[i],
          `ButtonLink child[${i}](${c.label})`,
          isLabelSpan
            ? { ignoreDataAttrs: ["data-site-button-label"] }
            : undefined,
        );
        if (isLabelSpan) {
          expect(
            siteContent.children[i].getAttribute("data-site-button-label"),
          ).toBe("true");
        }
      }
    }
  });

  it("SiteIcon matches Icon for decorative and labeled icons across sizes and colors", () => {
    const cases = [
      { icon: TestSvg, size: "sm" as const, color: "primary" as const },
      { icon: TestSvg, size: "md" as const, color: "secondary" as const },
      {
        icon: TestSvg,
        size: "lg" as const,
        color: "inherit" as const,
        label: "Included",
      },
    ];
    for (const c of cases) {
      const siteRoot = parseRoot(<SiteIcon {...c} />);
      const astryxRoot = parseRoot(<Icon {...c} />);
      assertElementParity(
        siteRoot,
        astryxRoot,
        `Icon(${c.size}/${c.color}/${c.label ?? "decorative"})`,
      );
    }
  });

  it("SiteTopNav and SiteTopNavItem match TopNav and TopNavItem", () => {
    const siteNav = parseRoot(
      <SiteTopNav
        label="Site navigation"
        heading={<span>Brand</span>}
        centerContent={<SiteTopNavItem href="/pricing" label="Prices" />}
        endContent={<a href="/login">Log in</a>}
      />,
    );
    const astryxNav = parseRoot(
      <TopNav
        label="Site navigation"
        heading={<span>Brand</span>}
        centerContent={<TopNavItem href="/pricing" label="Prices" />}
        endContent={<a href="/login">Log in</a>}
      />,
    );
    assertElementParity(siteNav, astryxNav, "TopNav root");
    expect(siteNav.children.length).toBe(astryxNav.children.length);
    for (let i = 0; i < siteNav.children.length; i++) {
      assertElementParity(
        siteNav.children[i],
        astryxNav.children[i],
        `TopNav slot[${i}]`,
      );
    }
    // Heading inner wrapper inside start slot
    assertElementParity(
      siteNav.children[0].children[0],
      astryxNav.children[0].children[0],
      "TopNav heading wrapper",
    );
    // TopNavItem inside center slot
    const siteItem = siteNav.querySelector("a[href='/pricing']");
    const astryxItem = astryxNav.querySelector("a[href='/pricing']");
    expect(siteItem).not.toBeNull();
    expect(astryxItem).not.toBeNull();
    if (siteItem && astryxItem) {
      assertElementParity(siteItem, astryxItem, "TopNavItem", {
        ignoreDataAttrs: ["data-astryx-pressable"],
      });
    }
  });

  it("SiteTable primitives match Table, TableHeader, TableBody, TableRow, TableHeaderCell and TableCell", () => {
    const siteRoot = parseRoot(
      <SiteTable aria-labelledby="compare-title">
        <SiteTableHeader>
          <SiteTableRow>
            <SiteTableHeaderCell scope="col">Feature</SiteTableHeaderCell>
            <SiteTableHeaderCell scope="col">Studio</SiteTableHeaderCell>
          </SiteTableRow>
        </SiteTableHeader>
        <SiteTableBody>
          <SiteTableRow>
            <SiteTableHeaderCell scope="row">Stems</SiteTableHeaderCell>
            <SiteTableCell>Included</SiteTableCell>
          </SiteTableRow>
        </SiteTableBody>
      </SiteTable>,
    );
    const astryxRoot = parseRoot(
      <Table aria-labelledby="compare-title">
        <TableHeader>
          <TableRow>
            <TableHeaderCell scope="col">Feature</TableHeaderCell>
            <TableHeaderCell scope="col">Studio</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableHeaderCell scope="row">Stems</TableHeaderCell>
            <TableCell>Included</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    // Scroll wrapper: SiteTable sets tabIndex=0 statically and omits runtime scroll-observer data-scroll-* attrs
    assertElementParity(siteRoot, astryxRoot, "Table scroll wrapper", {
      ignoreA11yAttrs: ["tabindex"],
      ignoreDataAttrs: [
        "data-scroll-axis",
        "data-scroll-inline-start",
        "data-scroll-inline-end",
        "data-scroll-block-start",
        "data-scroll-block-end",
      ],
    });
    expect(siteRoot.getAttribute("tabindex")).toBe("0");

    const siteTable = siteRoot.querySelector("table");
    const astryxTable = astryxRoot.querySelector("table");
    expect(siteTable).not.toBeNull();
    expect(astryxTable).not.toBeNull();
    if (siteTable && astryxTable) {
      assertElementParity(siteTable, astryxTable, "Table element");
    }

    const siteThead = siteRoot.querySelector("thead");
    const astryxThead = astryxRoot.querySelector("thead");
    if (siteThead && astryxThead) {
      assertElementParity(siteThead, astryxThead, "TableHeader");
    }

    const siteTbody = siteRoot.querySelector("tbody");
    const astryxTbody = astryxRoot.querySelector("tbody");
    if (siteTbody && astryxTbody) {
      assertElementParity(siteTbody, astryxTbody, "TableBody");
    }

    const siteRows = siteRoot.querySelectorAll("tr");
    const astryxRows = astryxRoot.querySelectorAll("tr");
    expect(siteRows.length).toBe(astryxRows.length);
    for (let i = 0; i < siteRows.length; i++) {
      assertElementParity(siteRows[i], astryxRows[i], `TableRow[${i}]`);
    }

    const siteThs = siteRoot.querySelectorAll("th");
    const astryxThs = astryxRoot.querySelectorAll("th");
    expect(siteThs.length).toBe(astryxThs.length);
    for (let i = 0; i < siteThs.length; i++) {
      assertElementParity(siteThs[i], astryxThs[i], `TableHeaderCell[${i}]`);
    }

    const siteTds = siteRoot.querySelectorAll("td");
    const astryxTds = astryxRoot.querySelectorAll("td");
    expect(siteTds.length).toBe(astryxTds.length);
    for (let i = 0; i < siteTds.length; i++) {
      assertElementParity(siteTds[i], astryxTds[i], `TableCell[${i}]`);
    }
  });
});
