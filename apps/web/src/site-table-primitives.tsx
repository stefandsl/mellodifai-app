import { stableClassName } from "@astryxdesign/core/naming";
import { focusOutlineStyles } from "@astryxdesign/core/utils/focusOutline.stylex";
import * as stylex from "@stylexjs/stylex";
import type {
  CSSProperties,
  HTMLAttributes,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";

type StyleArg = Parameters<typeof stylex.props>[number];

function sx(...styles: unknown[]): {
  className?: string;
  style?: CSSProperties;
} {
  return stylex.props(...(styles as StyleArg[]));
}

function joinClasses(...parts: (string | undefined | false | null)[]): string {
  return parts.filter(Boolean).join(" ");
}

// Compiled StyleX maps from @astryxdesign/core/dist/Table/* (balanced, middle, wrap, rows).

const SCROLL_WRAPPER_STYLES = {
  base: {
    kXHlph: "xw2csxc",
    kuHK5b: "x5lxg6s",
    $$css: true,
  },
  containerBleed: {
    keTefX: "xojxgvx",
    k71WvV: "x1fcf3bl",
    kzqmXN: "xx6qvi6",
    keoZOQ: "xxlrtwf",
    k1K539: "x1ddsecl",
    krdFHd: "x15mokao x1pf40mn",
    kfmiAY: "x1ga7v0g x3s3gbr",
    kVL7Gh: "xbiv7yw xr4wx9",
    kT0f0o: "x16uus16 x5vugwh",
    $$css: true,
  },
  focusRingInset: {
    kInvED: "xyk55c9",
    $$css: true,
  },
};

const TABLE_STYLES = {
  base: {
    kMv6JI: "xjb2p0i",
    kMwMTN: "x1tgivj0",
    $$css: true,
  },
  table: {
    kzqmXN: "xh8yej3",
    kLvRdT: "x1mwwwfo",
    kheTzg: "x1gukg7c",
    kPzzVL: "x140o2bo",
    "--_table-cell-word-break": "xmorb0d",
    "--_table-header-white-space": "xya44xs",
    $$css: true,
  },
  tableAutoLayout: {
    kPzzVL: "x1drmoe9",
    kTgw9: "x1lldw8n",
    "--_table-cell-word-break": "x1f03rzy",
    "--_table-header-white-space": "xghcpuh",
    $$css: true,
  },
};

const TABLE_ROW_MARKER = {
  x139im0d: "x139im0d",
  $$css: true,
};

const CONTAINER_EDGE_BALANCED = {
  kZCmMZ: "x9bi00s",
  "--_table-edge-inline-end": "x1w6xuo5 xzt5qtd",
  kwRFfy: "xf9a2z1",
  $$css: true,
};

const HEADER_CELL_STYLES = {
  cell: {
    k63SB2: "x2mo6ok",
    kMwMTN: "xv1l7n4",
    k9WMMc: "x1yc453h",
    $$css: true,
  },
  balanced: {
    k8WAf4: "xce4md1",
    "--_table-header-inline": "x1k2i0l5",
    kg3NbH: "xlz1w5s",
    "--_table-header-end-room": "x1lpvlbs",
    kGuDYH: "xcr08ib",
    kLWn49: "x1kq96og",
    kB7OPa: "x9f619",
    $$css: true,
  },
  divider: {
    "--_table-row-divider-width": "x6ivs5n",
    kt9PQ7: "x92x3c3",
    kfdmCh: "x1q0q8m5",
    kL6WhQ: "xw8gpjh",
    $$css: true,
  },
  headerOverflow: {
    kVQacm: "xb3r6kr",
    kg5iWk: "xlyipyv",
    khDVqt: "xfl0izk",
    kHjlTd: "x1mzt3pk",
    kTgw9: "xh6pgkp",
    $$css: true,
  },
};

const CELL_STYLES = {
  balanced: {
    k8WAf4: "xce4md1",
    kg3NbH: "xrrkdod",
    kGuDYH: "xjm74w1",
    kLWn49: "xw6l6zx",
    kB7OPa: "x9f619",
    $$css: true,
  },
  wrap: {
    kVQacm: "xb3r6kr",
    kHjlTd: "x1mzt3pk",
    kTgw9: "xh6pgkp",
    $$css: true,
  },
  verticalAlignMiddle: {
    kXLuUW: "xxymvpz",
    $$css: true,
  },
  dividerRow: {
    "--_table-row-divider-width": "x6ivs5n x1gxz47l",
    kt9PQ7: "x92x3c3 x1tnk5uh x1bougdg",
    kfdmCh: "x1q0q8m5",
    kL6WhQ: "xw8gpjh",
    $$css: true,
  },
};

export function SiteTable({
  className,
  children,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  const wrapperComputed = sx(
    SCROLL_WRAPPER_STYLES.base,
    SCROLL_WRAPPER_STYLES.containerBleed,
    focusOutlineStyles.focusVisible,
    SCROLL_WRAPPER_STYLES.focusRingInset,
  );
  const tableComputed = sx(
    TABLE_STYLES.table,
    TABLE_STYLES.tableAutoLayout,
    TABLE_STYLES.base,
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: Astryx TableScrollWrapper uses role="group" for the scrollable table region
    <div
      role="group"
      aria-labelledby={ariaLabelledBy}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table region must be keyboard focusable
      tabIndex={0}
      data-container-corner=""
      className={joinClasses(
        stableClassName("table-scroll-wrapper"),
        wrapperComputed.className,
      )}
    >
      <table
        aria-labelledby={ariaLabelledBy}
        className={joinClasses(
          stableClassName("table"),
          tableComputed.className,
          className,
        )}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export function SiteTableHeader({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={joinClasses(stableClassName("table-header"), className)}
      {...props}
    />
  );
}

export function SiteTableBody({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={joinClasses(stableClassName("table-body"), className)}
      {...props}
    />
  );
}

export function SiteTableRow({
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  const computed = sx(TABLE_ROW_MARKER);
  return (
    <tr
      className={joinClasses(
        stableClassName("table-row"),
        computed.className,
        className,
      )}
      {...props}
    />
  );
}

export function SiteTableHeaderCell({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  const computed = sx(
    HEADER_CELL_STYLES.cell,
    HEADER_CELL_STYLES.balanced,
    HEADER_CELL_STYLES.divider,
    HEADER_CELL_STYLES.headerOverflow,
    CONTAINER_EDGE_BALANCED,
  );
  return (
    <th
      data-density="balanced"
      className={joinClasses(
        stableClassName("table-header-cell"),
        computed.className,
        className,
      )}
      {...props}
    />
  );
}

export function SiteTableCell({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  const computed = sx(
    CELL_STYLES.balanced,
    CELL_STYLES.wrap,
    CONTAINER_EDGE_BALANCED,
    CELL_STYLES.verticalAlignMiddle,
    CELL_STYLES.dividerRow,
  );
  return (
    <td
      data-density="balanced"
      className={joinClasses(
        stableClassName("table-cell"),
        computed.className,
        className,
      )}
      {...props}
    />
  );
}
