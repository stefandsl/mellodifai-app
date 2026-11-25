import {
  type IconSize,
  iconBoxSizeStyles,
  iconSizeStyles,
} from "@astryxdesign/core/Icon/IconSize.stylex";
import { touchHitAreaStyles } from "@astryxdesign/core/internal/touchHitArea.stylex";
import { EDGE_COMP_ATTR } from "@astryxdesign/core/Layout/edgeCompensation.stylex";
import { stableClassName } from "@astryxdesign/core/naming";
import {
  colorStyles,
  defaultWeightByTypeStyles,
  displayStyles,
  justifyStyles,
  sizeByLevelStyles,
  sizeByTypeStyles,
  sizeStyles,
  textWrapStyles,
  truncationStyles,
  weightStyles,
  wordBreakStyles,
} from "@astryxdesign/core/Text/text.stylex";
import { focusOutlineProps } from "@astryxdesign/core/utils/focusOutline.stylex";
import { interactionOverlayStyles } from "@astryxdesign/core/utils/interactionOverlay.stylex";
import * as stylex from "@stylexjs/stylex";
import type {
  AnchorHTMLAttributes,
  ComponentType,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
  SVGProps,
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

function mergeStyle(
  a?: CSSProperties,
  b?: CSSProperties,
): CSSProperties | undefined {
  if (a && b) return { ...a, ...b };
  return b ?? a;
}

// ---------- Text ----------

type TextType = keyof typeof sizeByTypeStyles;
type TextColor = keyof typeof colorStyles;
type TextSize = keyof typeof sizeStyles;
type TextWeight = keyof typeof weightStyles;
type TextDisplay = keyof typeof displayStyles;
type TextJustify = keyof typeof justifyStyles;
type TextWrap = keyof typeof textWrapStyles;
type TextWordBreak = keyof typeof wordBreakStyles;

const DEFAULT_COLOR_BY_TYPE: Record<TextType, TextColor> = {
  body: "primary",
  large: "primary",
  label: "primary",
  supporting: "secondary",
  code: "primary",
  "display-1": "primary",
  "display-2": "primary",
  "display-3": "primary",
  inherit: "inherit",
};

export type SiteTextProps = Omit<HTMLAttributes<HTMLElement>, "color"> & {
  as?: "span" | "p" | "div" | "label";
  type?: TextType;
  size?: TextSize;
  color?: TextColor;
  weight?: TextWeight;
  display?: TextDisplay;
  maxLines?: number;
  wordBreak?: TextWordBreak;
  textWrap?: TextWrap;
  justify?: TextJustify;
};

export function SiteText({
  as: Component = "span",
  type = "body",
  size,
  color,
  weight,
  display = "inline",
  maxLines = 0,
  wordBreak,
  textWrap,
  justify = "start",
  className,
  style,
  children,
  ...props
}: SiteTextProps) {
  const resolvedColor = color ?? DEFAULT_COLOR_BY_TYPE[type];
  const resolvedWordBreak =
    wordBreak ?? (maxLines === 1 ? "break-all" : "break-word");
  const resolvedDisplay = maxLines > 0 ? "block" : display;
  const computed = sx(
    colorStyles[resolvedColor],
    sizeByTypeStyles[type],
    size && sizeStyles[size],
    defaultWeightByTypeStyles[type],
    weight && weightStyles[weight],
    maxLines === 1
      ? truncationStyles.singleLine
      : maxLines > 1
        ? truncationStyles.multiLine
        : displayStyles[resolvedDisplay],
    maxLines > 0 && wordBreakStyles[resolvedWordBreak],
    textWrap && textWrapStyles[textWrap],
    justify !== "start" && justifyStyles[justify],
  );
  const clampStyle = maxLines > 1 ? { WebkitLineClamp: maxLines } : undefined;
  return (
    <Component
      data-type={type}
      data-size={size}
      data-color={resolvedColor}
      className={joinClasses(
        stableClassName("text"),
        computed.className,
        className,
      )}
      style={mergeStyle(computed.style, mergeStyle(style, clampStyle))}
      {...props}
    >
      {children}
    </Component>
  );
}

// ---------- Heading ----------

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
type HeadingDisplayType = "display-1" | "display-2" | "display-3";

const LEVEL_TAG = {
  1: "h1",
  2: "h2",
  3: "h3",
  4: "h4",
  5: "h5",
  6: "h6",
} as const;

export type SiteHeadingProps = Omit<
  HTMLAttributes<HTMLHeadingElement>,
  "color"
> & {
  level: HeadingLevel;
  type?: HeadingDisplayType;
  weight?: TextWeight;
  color?: TextColor;
  display?: TextDisplay;
  maxLines?: number;
  wordBreak?: TextWordBreak;
  textWrap?: TextWrap;
  justify?: TextJustify;
};

export function SiteHeading({
  level,
  type,
  weight,
  color = "primary",
  display = "block",
  maxLines = 0,
  wordBreak,
  textWrap,
  justify = "start",
  className,
  style,
  children,
  ...props
}: SiteHeadingProps) {
  const Component = LEVEL_TAG[level];
  const resolvedWordBreak =
    wordBreak ?? (maxLines === 1 ? "break-all" : "break-word");
  const resolvedDisplay = maxLines > 0 ? "block" : display;
  const computed = sx(
    colorStyles[color],
    type ? sizeByTypeStyles[type] : sizeByLevelStyles[level],
    type && defaultWeightByTypeStyles[type],
    weight && weightStyles[weight],
    maxLines === 1
      ? truncationStyles.singleLine
      : maxLines > 1
        ? truncationStyles.multiLine
        : displayStyles[resolvedDisplay],
    maxLines > 0 && wordBreakStyles[resolvedWordBreak],
    textWrap && textWrapStyles[textWrap],
    justify !== "start" && justifyStyles[justify],
  );
  const clampStyle = maxLines > 1 ? { WebkitLineClamp: maxLines } : undefined;
  return (
    <Component
      data-level={String(level)}
      data-color={color}
      data-type={type}
      data-weight={weight}
      className={joinClasses(
        stableClassName("heading"),
        computed.className,
        className,
      )}
      style={mergeStyle(computed.style, mergeStyle(style, clampStyle))}
      {...props}
    >
      {children}
    </Component>
  );
}

// ---------- Link (compiled StyleX maps from @astryxdesign/core/dist/Link/Link.js) ----------

const LINK_STYLES = {
  base: {
    k1xSpc: "x3nfvp2",
    ks0D6T: "x193iq5w",
    kGNEyG: "x6s0dn4",
    kOIVth: "x1lsbc85",
    kMv6JI: "xjb2p0i",
    kGuDYH: "x1qlqyl8",
    kLWn49: "x15bjb6t",
    k63SB2: "x1pd3egz",
    kybGjl: "x1hl2dhg x13nosk6",
    kkrTdU: "x1ypdohk x16khyan",
    k1ekBW: "x1mpt4pi",
    kIyJzY: "xuedmi6",
    kAMwcw: "xlr8y92",
    $$css: true,
  },
  hasUnderline: {
    kybGjl: "x1bvjpef",
    $$css: true,
  },
};

const LINK_COLOR_STYLES = {
  primary: { kMwMTN: "x1tgivj0 xcunlro", $$css: true },
  secondary: { kMwMTN: "xv1l7n4 x7jm8ul", $$css: true },
  disabled: { kMwMTN: "xnbbluu", $$css: true },
  placeholder: { kMwMTN: "xv1l7n4", $$css: true },
  accent: { kMwMTN: "xjse4m1 xg8kd7y", $$css: true },
  inherit: { kMwMTN: "x1heor9g", $$css: true },
};

export type SiteLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "color"
> & {
  href: string;
  label?: string;
  color?: keyof typeof LINK_COLOR_STYLES;
  type?: TextType;
  size?: TextSize;
  weight?: TextWeight;
  display?: TextDisplay;
  hasUnderline?: boolean;
};

export function SiteLink({
  href,
  label,
  color = "accent",
  type = "body",
  size,
  weight,
  display = "inline",
  hasUnderline = false,
  className,
  style,
  children,
  ...props
}: SiteLinkProps) {
  const computed = focusOutlineProps.focusVisible(
    LINK_STYLES.base,
    LINK_COLOR_STYLES[color],
    interactionOverlayStyles.pressedBackgroundColor,
    hasUnderline && LINK_STYLES.hasUnderline,
  );
  return (
    <a
      href={href}
      aria-label={label || undefined}
      className={joinClasses(
        stableClassName("link"),
        computed.className,
        className,
      )}
      style={mergeStyle(computed.style as CSSProperties | undefined, style)}
      {...props}
      data-color={color}
    >
      <SiteText
        type={type}
        size={size}
        weight={weight}
        color="inherit"
        display={display}
        className="xeuugli"
      >
        {children}
      </SiteText>
    </a>
  );
}

// ---------- ButtonLink (compiled StyleX maps from @astryxdesign/core/dist/Button/Button.js) ----------

const BUTTON_STYLES = {
  base: {
    "--button-focus-offset": "x16bblx1",
    kInvED: "x1wfwxd8 x13aywxo",
    kVAEAm: "x1n2onr6",
    k1xSpc: "x3nfvp2",
    kGNEyG: "x6s0dn4",
    kjj79g: "xl56j7k",
    kOIVth: "x1txdalj",
    k8WAf4: "xce4md1",
    kg3NbH: "xrrkdod",
    kMzoRj: "xc342km",
    ksu8eU: "xng3xce",
    kaIpWk: "x1jxw6zd",
    kMv6JI: "xjb2p0i",
    kGuDYH: "xcr08ib",
    kLWn49: "x1kq96og",
    k63SB2: "x1e4wzip",
    khDVqt: "xuxw1ft",
    k7Eaqz: "xeuugli",
    ks0D6T: "x193iq5w",
    kkrTdU: "x1ypdohk x16khyan",
    k1ekBW: "xrafxwg xrkqygm",
    kIyJzY: "xuedmi6 x12w9bfk",
    kAMwcw: "xlr8y92",
    $$css: true,
  },
  pressable: {
    k3aq6I:
      "x3oybdh x1u44piu x1pcrg6r xhr8rl2 x1ua7476 x11q126q x7208gc x6cxksl",
    $$css: true,
  },
  link: {
    kybGjl: "x1hl2dhg",
    $$css: true,
  },
  elevationNone: {
    kGVxlE: "x1gnnqk1",
    $$css: true,
  },
  forcedColorsStandalone: {
    kMzoRj: "xc342km x13rsnn2",
    ksu8eU: "xng3xce xx61lck",
    kVAM5u: "x1ylmb6m",
    $$css: true,
  },
  width: {
    kzqmXN: "x5lhr3w",
    $$css: true,
  },
  contentWrapper: {
    k1xSpc: "x78zum5",
    kzQI83: "x1iyjqo2",
    kmuXW: "xs83m0k",
    kCS8Yb: "xdl72j9",
    kSGwAc: "xkh2ocl",
    kXwgrk: "x1beo9mf",
    kwnvtZ: "x18qz0cn",
    kGNEyG: "x1h91t0o",
    kjj79g: "xarpa2k",
    kOIVth: "x14kbac9",
    k7Eaqz: "xeuugli",
    $$css: true,
  },
  iconWrapper: {
    k1xSpc: "x3nfvp2",
    kGNEyG: "x6s0dn4",
    kjj79g: "xl56j7k",
    kmuXW: "x2lah0s",
    $$css: true,
  },
};

const BUTTON_PRESS_STYLES = {
  rowCell: {
    kKwaWg: "x7ngsy6 x10ogxw0 xubczrd x18xnkjv",
    kKVMdj: "x14e4jsf x6su2wr",
    kHBbk8: "xif6eam",
    kgeoSG: "x1ocadqd",
    kEoFBp: "x1ukh9kf",
    kFcpXp: "xrkptjy",
    kxmVGU: "xjscm90",
    kPB484: "x1kec4ew",
    km8f2m: "x13r5q6d",
    kLkRvE: "x1dn949c",
    k5QlbN: "xw7rim2 xr9xsjc",
    k7EzDT: "x1bxn267",
    kQZAMR: "x1osot8d xbkwwzw",
    kZiNAr: "x10t12yn",
    k8Tatv: "x1dn5vsf",
    $$css: true,
  },
  rowCellOnImage: {
    kKwaWg: "x7uyq82 x3f84ok x7ngsy6 x10ogxw0 xubczrd x18xnkjv xmvprkv xetgvay",
    $$css: true,
  },
  control: {
    k6sLGO: "x1mrddfy",
    $$css: true,
  },
};

const BUTTON_SIZE_STYLES = {
  sm: { kZKoxP: "x7xd7g3", $$css: true },
  md: { kZKoxP: "x11l75t8", $$css: true },
  lg: { kZKoxP: "xbswrv2", $$css: true },
};

const BUTTON_VARIANTS = {
  primary: {
    kWkggS: "x1ewilqj",
    kMwMTN: "x17wrial",
    "--_button-fill": "x1kbggj7",
    "--_button-on-fill": "xysjls1",
    $$css: true,
  },
  secondary: {
    kWkggS: "x17x4s8c",
    kMwMTN: "x1tgivj0",
    $$css: true,
  },
  ghost: {
    kWkggS: "xjbqb8w",
    kMwMTN: "x1tgivj0",
    $$css: true,
  },
};

const BUTTON_ICON_SIZE: Record<keyof typeof BUTTON_SIZE_STYLES, IconSize> = {
  sm: "sm",
  md: "sm",
  lg: "md",
};

export type SiteButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  label: string;
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZE_STYLES;
  width?: string | number;
  icon?: ReactNode;
};

export function SiteButtonLink({
  href,
  label,
  variant = "secondary",
  size = "md",
  width,
  icon,
  className,
  style,
  children,
  ...props
}: SiteButtonLinkProps) {
  const isSolid = variant === "primary" || variant === "secondary";
  const computed = focusOutlineProps.focusVisible(
    BUTTON_STYLES.base,
    BUTTON_SIZE_STYLES[size],
    interactionOverlayStyles.backgroundImage,
    BUTTON_PRESS_STYLES.rowCell,
    BUTTON_PRESS_STYLES.rowCellOnImage,
    BUTTON_PRESS_STYLES.control,
    BUTTON_STYLES.link,
    BUTTON_STYLES.pressable,
    BUTTON_STYLES.elevationNone,
    width != null && BUTTON_STYLES.width,
    isSolid && BUTTON_STYLES.forcedColorsStandalone,
    BUTTON_VARIANTS[variant],
  );
  const widthStyle =
    width != null
      ? ({
          "--x-width": typeof width === "number" ? `${width}px` : width,
        } as CSSProperties)
      : undefined;
  const contentProps = sx(
    BUTTON_STYLES.contentWrapper,
    touchHitAreaStyles.layer,
  );
  const iconBoxProps = sx(
    BUTTON_STYLES.iconWrapper,
    iconBoxSizeStyles[BUTTON_ICON_SIZE[size]],
  );
  return (
    <a
      href={href}
      data-variant={variant}
      data-size={size}
      data-elevation="none"
      {...(variant === "ghost" ? { [EDGE_COMP_ATTR]: "" } : null)}
      aria-label={children != null && children !== label ? label : undefined}
      className={joinClasses(
        stableClassName("button"),
        computed.className,
        className,
      )}
      style={mergeStyle(
        mergeStyle(computed.style as CSSProperties | undefined, widthStyle),
        style,
      )}
      {...props}
    >
      <span className={contentProps.className}>
        {icon != null ? (
          <span className={iconBoxProps.className}>{icon}</span>
        ) : null}
        <span className="xb3r6kr xlyipyv xeuugli">{children ?? label}</span>
      </span>
    </a>
  );
}

// ---------- Icon (compiled StyleX maps from @astryxdesign/core/dist/Icon/Icon.js) ----------

const ICON_ROOT_STYLE = { kmuXW: "x2lah0s", $$css: true };

const ICON_COLOR_STYLES = {
  primary: { kMwMTN: "xtbr613", $$css: true },
  secondary: { kMwMTN: "xv9yike", $$css: true },
  inherit: { kMwMTN: "x1heor9g", $$css: true },
};

export type SiteIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  size?: IconSize;
  color?: keyof typeof ICON_COLOR_STYLES;
  label?: string;
};

export function SiteIcon({
  icon: IconComponent,
  size = "md",
  color = "inherit",
  label,
  className,
  style,
  ...props
}: SiteIconProps) {
  const a11yProps =
    label != null && label !== ""
      ? { role: "img", "aria-label": label, "aria-hidden": undefined }
      : { "aria-hidden": true as const };
  const computed = sx(
    ICON_ROOT_STYLE,
    ICON_COLOR_STYLES[color],
    iconSizeStyles[size],
  );
  return (
    <IconComponent
      {...a11yProps}
      data-size={size}
      data-color={color}
      className={joinClasses(
        stableClassName("icon"),
        computed.className,
        className,
      )}
      style={mergeStyle(computed.style, style)}
      {...props}
    />
  );
}

// ---------- TopNav & TopNavItem (compiled StyleX maps from @astryxdesign/core/dist/TopNav/*) ----------

const TOP_NAV_STYLES = {
  base: {
    kGNEyG: "x6s0dn4",
    kzqmXN: "xh8yej3",
    kmVPX3: "xlsj2fj",
    kB7OPa: "x9f619",
    $$css: true,
  },
  baseFlex: {
    k1xSpc: "x78zum5",
    kwnvtZ: "x1a02dak",
    $$css: true,
  },
  centerContent: {
    k1xSpc: "x78zum5",
    kGNEyG: "x6s0dn4",
    kjj79g: "xl56j7k",
    kOIVth: "xzye2dw",
    kzQI83: "x1ui36gj",
    kmuXW: "xs83m0k",
    kCS8Yb: "x1rnznto",
    k7Eaqz: "xeuugli",
    ks0D6T: "x1t8xbu",
    $$css: true,
  },
};

export type SiteTopNavProps = HTMLAttributes<HTMLElement> & {
  label: string;
  heading?: ReactNode;
  centerContent?: ReactNode;
  endContent?: ReactNode;
};

export function SiteTopNav({
  label,
  heading,
  centerContent,
  endContent,
  className,
  style,
  ...props
}: SiteTopNavProps) {
  const navComputed = sx(TOP_NAV_STYLES.base, TOP_NAV_STYLES.baseFlex);
  const centerComputed = sx(TOP_NAV_STYLES.centerContent);
  return (
    <nav
      // biome-ignore lint/a11y/noRedundantRoles: matches @astryxdesign/core/TopNav explicit role="navigation"
      role="navigation"
      aria-label={label}
      className={joinClasses(
        stableClassName("top-nav"),
        navComputed.className,
        className,
      )}
      style={mergeStyle(navComputed.style, style)}
      {...props}
    >
      <div className="x78zum5 x1a02dak x6s0dn4 x18g69wz x845mor x9qo7ot">
        {heading != null ? (
          <div className="x78zum5 x6s0dn4 xs83m0k">{heading}</div>
        ) : null}
      </div>
      {centerContent != null ? (
        <div className={centerComputed.className}>{centerContent}</div>
      ) : null}
      <div className="x78zum5 x1a02dak x6s0dn4 x13a6bvl xzye2dw x845mor x9qo7ot">
        {endContent}
      </div>
    </nav>
  );
}

const TOP_NAV_ITEM_STYLES = {
  base: {
    k1xSpc: "x3nfvp2",
    kGNEyG: "x6s0dn4",
    kOIVth: "x1txdalj",
    k8WAf4: "x1vofgu7",
    kg3NbH: "xrrkdod",
    kaIpWk: "xh6dtrn",
    kGuDYH: "xcr08ib",
    kLWn49: "x1kq96og",
    k63SB2: "x1e4wzip",
    kMwMTN: "xv1l7n4",
    kybGjl: "x1hl2dhg",
    kkrTdU: "x1ypdohk x16khyan",
    k1ekBW: "xs2xxs2",
    kIyJzY: "xuedmi6",
    kAMwcw: "xlr8y92",
    $$css: true,
  },
};

export type SiteTopNavItemProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  label: string;
};

export function SiteTopNavItem({
  href,
  label,
  className,
  style,
  children,
  ...props
}: SiteTopNavItemProps) {
  const computed = focusOutlineProps.focusVisible(
    TOP_NAV_ITEM_STYLES.base,
    interactionOverlayStyles.backgroundColor,
  );
  return (
    <a
      href={href}
      className={joinClasses(
        stableClassName("top-nav-item"),
        computed.className,
        className,
      )}
      style={mergeStyle(computed.style as CSSProperties | undefined, style)}
      {...props}
    >
      {children ?? label}
    </a>
  );
}

export function SiteAgentsMenuHost({
  itemsJson,
  children,
}: {
  itemsJson: string;
  children: ReactNode;
}) {
  return <div data-site-agents-menu={itemsJson}>{children}</div>;
}
