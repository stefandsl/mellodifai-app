// MellodifAI Mesh: the public site theme. Values come from the gauntlet winner
// (E:/mellodifai/research/2026-11-20/cardboard/gauntlet-mesh/run1/final-r3/tokens.css).
// Every colour, size and spacing value of the site lives here; site.css only reads tokens.
// Colour tokens are [light, dark] pairs. Build: pnpm exec astryx theme build src/themes/mesh/meshTheme.ts
import { defineTheme } from "@astryxdesign/core/theme";

type Rgb = readonly [number, number, number];
const ink950: Rgb = [7, 7, 10];
const ink900: Rgb = [13, 13, 17];
const ink880: Rgb = [20, 20, 22];
const ink850: Rgb = [18, 18, 22];
const ink700: Rgb = [36, 36, 42];
const ink600: Rgb = [52, 52, 59];
const black: Rgb = [0, 0, 0];
const paper0: Rgb = [255, 255, 255];
const paper50: Rgb = [247, 244, 239];
const paper75: Rgb = [246, 244, 241];
const paper150: Rgb = [231, 227, 219];
const paper200: Rgb = [220, 214, 203];
const ember400: Rgb = [255, 107, 98];
const ember500: Rgb = [242, 51, 61]; // the brand red: logo, accent word, main button
const ember600: Rgb = [217, 31, 43];
const ember700: Rgb = [179, 20, 31];
const brass400: Rgb = [240, 182, 96];
const brass500: Rgb = [224, 154, 58];
const iris500: Rgb = [124, 92, 255];
const jade400: Rgb = [62, 207, 142];
const jade700: Rgb = [10, 107, 66];

const c = (rgb: Rgb, alpha = 1) =>
  alpha === 1 ? `rgb(${rgb.join(" ")})` : `rgb(${rgb.join(" ")} / ${alpha})`;
type Pair = [string, string];
const pair = (light: string, dark: string): Pair => [light, dark];

const fade = "72%";
const gradient = (size: string, at: string, colour: string) =>
  `radial-gradient(${size} at ${at}, var(${colour}), transparent var(--mesh-fade))`;

export const meshTheme = defineTheme({
  name: "mesh",
  tokens: {
    // Surfaces
    "--color-background-body": pair(c(paper75), c(ink950)),
    "--color-background-surface": pair(c(paper0), c(ink900)),
    "--color-background-card": pair(c(paper0), c(ink850)),
    "--color-background-muted": pair(c(paper150), c(ink700)),
    "--color-background-popover": pair(c(paper0), c(ink900)),
    "--color-background-inverted": pair(c(ink880), c(paper50)),
    "--color-overlay": pair(c(ink950, 0.78), c(ink950, 0.78)),
    "--color-overlay-hover": pair(c(ink880, 0.05), c(paper50, 0.06)),
    "--color-overlay-pressed": pair(c(ink880, 0.1), c(paper50, 0.12)),
    // Text and icons
    "--color-text-primary": pair(c(ink880), c(paper50)),
    "--color-text-secondary": pair(c(ink880, 0.78), c(paper50, 0.68)),
    "--color-text-accent": pair(c(ember700), c(ember400)),
    "--color-icon-primary": pair(c(ink880), c(paper50)),
    "--color-icon-secondary": pair(c(ink880, 0.78), c(paper50, 0.68)),
    // Brand: one red family. Dark text on the ember button (contrast 5.0 and up).
    "--color-accent": pair(c(ember500), c(ember500)),
    "--color-accent-muted": pair(c(ember600, 0.1), c(ember500, 0.16)),
    "--color-on-accent": pair(c(ink950), c(ink950)),
    // Lines
    "--color-border": pair(c(ink880, 0.12), c(paper50, 0.1)),
    "--color-border-emphasized": pair(c(ink880, 0.3), c(paper50, 0.24)),
    "--color-track": pair(c(ink880, 0.38), c(paper50, 0.34)),
    "--color-shadow": pair(c(ink880, 0.1), c(black, 0.4)),
    "--color-icon-success": pair(c(jade700), c(jade400)),
    "--color-success-muted": pair(c(jade700, 0.1), c(jade400, 0.16)),
    "--focus-outline-color": pair(c(ink880), c(paper50)),
    // Type
    "--font-family-heading":
      '"Instrument Serif", "Instrument Serif Fallback", "Instrument Serif Fallback Georgia", "Instrument Serif Fallback Noto", serif',
    "--font-family-body":
      '"Figtree", "Figtree Fallback", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    "--font-family-code":
      '"IBM Plex Mono", "IBM Plex Mono Fallback Consolas", "IBM Plex Mono Fallback", ui-monospace, Menlo, Consolas, monospace',
    "--font-weight-normal": "400",
    "--font-weight-medium": "500",
    "--font-weight-semibold": "600",
    "--font-size-2xs": "0.75rem",
    "--font-size-sm": "0.875rem",
    "--font-size-base": "1rem",
    "--font-size-lg": "1.25rem",
    "--font-size-xl": "1.75rem",
    "--font-size-2xl": "2rem",
    "--font-size-3xl": "2.5rem",
    "--font-size-4xl": "3.25rem",
    "--text-display-1-size": "clamp(2.5rem, 8vw, 3.75rem)",
    "--text-display-1-leading": "1",
    "--text-display-1-weight": "400",
    "--text-display-2-size": "var(--font-size-3xl)",
    "--text-display-2-leading": "1.1",
    "--text-display-2-weight": "400",
    "--text-display-3-size": "var(--font-size-xl)",
    "--text-display-3-leading": "1.15",
    "--text-display-3-weight": "400",
    "--text-heading-1-size": "var(--font-size-2xl)",
    "--text-heading-1-leading": "1.125",
    "--text-heading-1-weight": "400",
    "--text-heading-2-size": "var(--font-size-xl)",
    "--text-heading-2-leading": "1.4286",
    "--text-heading-2-weight": "400",
    "--text-heading-3-size": "var(--font-size-lg)",
    "--text-heading-3-leading": "1.4",
    "--text-heading-3-weight": "500",
    "--text-large-size": "var(--font-size-lg)",
    "--text-large-leading": "1.4",
    "--text-large-weight": "400",
    "--text-body-size": "var(--font-size-base)",
    "--text-body-leading": "1.5",
    "--text-body-weight": "400",
    "--text-label-size": "var(--font-size-base)",
    "--text-label-leading": "1.5",
    "--text-label-weight": "600",
    "--text-supporting-size": "var(--font-size-sm)",
    "--text-supporting-leading": "1.5",
    "--text-supporting-weight": "400",
    "--text-code-size": "var(--font-size-2xs)",
    "--text-code-leading": "1.3333",
    "--text-code-weight": "500",
    // Space (one step = 4 px at the default text size)
    "--spacing-0-5": "0.125rem",
    "--spacing-1": "0.25rem",
    "--spacing-1-5": "0.375rem",
    "--spacing-2": "0.5rem",
    "--spacing-3": "0.75rem",
    "--spacing-4": "1rem",
    "--spacing-5": "1.25rem",
    "--spacing-6": "1.5rem",
    "--spacing-8": "2rem",
    "--spacing-10": "2.5rem",
    "--spacing-12": "3rem",
    // Sizes, lines, radius
    "--size-element-sm": "2rem",
    "--size-element-md": "2.125rem",
    "--size-element-lg": "2.75rem",
    "--border-width": "1px",
    "--radius-inner": "6px",
    "--radius-element": "12px",
    "--radius-container": "16px",
    "--radius-page": "20px",
    "--radius-full": "9999px",
    "--focus-outline-width": "2px",
    "--focus-outline-style": "solid",
    "--focus-outline-offset": "3px",
    "--shadow-low": pair(
      `0 1px 2px ${c(ink880, 0.1)}`,
      `0 1px 2px ${c(black, 0.4)}`,
    ),
    "--shadow-med": pair(
      `0 12px 30px ${c(ink880, 0.1)}`,
      `0 12px 30px ${c(black, 0.4)}`,
    ),
    "--shadow-high": pair(
      `0 30px 80px ${c(ink880, 0.16)}`,
      `0 30px 80px ${c(black, 0.6)}`,
    ),
    // Motion
    "--duration-fast": "150ms",
    "--duration-medium": "300ms",
    "--duration-slow": "500ms",
    "--ease-standard": "cubic-bezier(0.4, 0, 0.2, 1)",
    "--ease-entrance": "cubic-bezier(0.16, 1, 0.3, 1)",
    "--ease-move": "cubic-bezier(0, 0, 0.2, 1)",
  },
  localTokens: {
    "--layout-content-width": "80rem", // 1280
    // Colour roles Astryx has no name for
    "--ui-muted-hover": pair(c(paper200), c(ink600)),
    "--ui-inverted-hover": pair(c(ink600), c(paper200)),
    "--ui-on-inverted": pair(c(paper50), c(ink950)),
    "--ui-accent-hover": pair(c(ember600), c(ember400)),
    "--ui-on-dark": pair(c(paper50), c(paper50)),
    "--ui-scrim": pair(c(paper75, 0.92), c(ink950, 0.92)),
    // The brand mark is drawn in the ember token, so logo and accent word are one red.
    "--brand-ember": pair(c(ember500), c(ember500)),
    // Glass: the header after scroll and the cards that stand in a mesh field
    "--glass-background": pair(c(paper0, 0.72), c(ink900, 0.72)),
    "--glass-background-solid": pair(c(paper0, 0.96), c(ink900, 0.96)),
    "--glass-filter": "blur(1.5rem) saturate(1.5)",
    "--glass-filter-badge": "blur(0.5rem)",
    "--glass-edge": pair(
      `inset 0 1px 0 ${c(ink880, 0.12)}`,
      `inset 0 1px 0 ${c(paper50, 0.1)}`,
    ),
    // Mesh: three hues (ember, brass, iris), each a field, a faint field and a hot core.
    "--mesh-fade": fade,
    "--mesh-ember": pair(c(ember500, 0.3), c(ember500, 0.58)),
    "--mesh-ember-core": pair(c(ember500, 0.4), c(ember400, 0.62)),
    "--mesh-ember-soft": pair(c(ember500, 0.14), c(ember500, 0.28)),
    "--mesh-brass": pair(c(brass500, 0.26), c(brass500, 0.3)),
    "--mesh-brass-core": pair(c(brass500, 0.34), c(brass400, 0.4)),
    "--mesh-brass-soft": pair(c(brass500, 0.14), c(brass500, 0.2)),
    "--mesh-iris": pair(c(iris500, 0.2), c(iris500, 0.4)),
    "--mesh-iris-soft": pair(c(iris500, 0.14), c(iris500, 0.3)),
    "--mesh-cover-ember": pair(c(ember500, 0.86), c(ember500, 0.86)),
    "--mesh-cover-brass": pair(c(brass500, 0.86), c(brass500, 0.86)),
    "--mesh-cover-iris": pair(c(iris500, 0.86), c(iris500, 0.86)),
    "--mesh-cover-base": pair(c(ink900), c(ink900)),
    "--mesh-rise": "13rem",
    "--mesh-sky-size": "34rem",
    "--mesh-stage": [
      gradient("26% 1.5rem", "32% var(--mesh-rise)", "--mesh-ember-core"),
      gradient("18% 1.25rem", "63% var(--mesh-rise)", "--mesh-brass-core"),
      gradient("34% 11rem", "31% var(--mesh-rise)", "--mesh-ember"),
      gradient("25% 9rem", "63% var(--mesh-rise)", "--mesh-brass"),
      gradient("22% 10rem", "90% var(--mesh-rise)", "--mesh-iris"),
      gradient("18% 9rem", "8% var(--mesh-rise)", "--mesh-iris"),
      gradient("44% 42%", "14% 68%", "--mesh-ember-soft"),
      gradient("40% 40%", "90% 70%", "--mesh-iris-soft"),
    ].join(", "),
    "--mesh-sky": gradient("46% 78%", "100% 0%", "--mesh-iris-soft"),
    "--mesh-halo-cool": [
      gradient("44% 46%", "68% 34%", "--mesh-iris-soft"),
      gradient("44% 44%", "32% 68%", "--mesh-ember-soft"),
    ].join(", "),
    "--mesh-halo-warm": [
      gradient("44% 42%", "60% 31%", "--mesh-ember-soft"),
      gradient("44% 42%", "40% 69%", "--mesh-brass-soft"),
    ].join(", "),
    "--mesh-floor": [
      gradient("28% 1.5rem", "66% 100%", "--mesh-ember-core"),
      gradient("18% 1.25rem", "34% 100%", "--mesh-brass-core"),
      gradient("36% 11rem", "66% 100%", "--mesh-ember"),
      gradient("25% 9rem", "34% 100%", "--mesh-brass"),
      gradient("20% 10rem", "8% 100%", "--mesh-iris"),
      gradient("18% 9rem", "94% 100%", "--mesh-iris"),
      gradient("64% 62%", "50% 100%", "--mesh-ember-soft"),
    ].join(", "),
    "--mesh-panel": [
      gradient("70% 1.5rem", "30% 100%", "--mesh-ember-core"),
      gradient("90% 16rem", "24% 100%", "--mesh-ember"),
      gradient("70% 14rem", "100% 100%", "--mesh-iris"),
    ].join(", "),
    "--mesh-cover-remix": [
      gradient("70% 85%", "96% 92%", "--mesh-cover-ember"),
      gradient("66% 80%", "4% 6%", "--mesh-cover-iris"),
      gradient("42% 52%", "58% 30%", "--mesh-brass"),
    ].join(", "),
    "--mesh-cover-cover": [
      gradient("74% 88%", "92% 4%", "--mesh-cover-brass"),
      gradient("70% 84%", "6% 96%", "--mesh-cover-ember"),
      gradient("40% 50%", "40% 40%", "--mesh-iris"),
    ].join(", "),
    "--mesh-cover-satire": [
      gradient("72% 86%", "8% 10%", "--mesh-cover-ember"),
      gradient("70% 84%", "96% 94%", "--mesh-cover-iris"),
      gradient("44% 54%", "62% 40%", "--mesh-brass"),
    ].join(", "),
    "--mesh-cover-blur": "1.25rem",
    "--mesh-edge": `linear-gradient(90deg, transparent 0%, ${c(iris500)} 10%, ${c(ember500)} 38%, ${c(brass500)} 68%, ${c(iris500)} 92%, transparent 100%)`,
    // Art: the drawings in the page
    "--art-line": pair(c(paper50, 0.34), c(paper50, 0.34)),
    "--art-line-strong": pair(c(paper50, 0.7), c(paper50, 0.7)),
    "--art-wordmark-line": pair(c(ink880, 0.26), c(paper50, 0.2)),
    "--art-logo-size": "1.75rem",
    "--art-icon-size": "1rem",
    "--art-dot-size": "0.5rem",
    "--art-rule-height": "3.4375rem",
    "--art-line-width": "1px",
    "--art-strike-width": "2px",
    // Type roles of the site
    "--type-eyebrow-tracking": "0.09em",
    "--type-tracking-display": "-0.022em",
    "--type-tracking-heading": "-0.012em",
    "--type-brand-size": "1.5rem",
    "--type-brand-size-narrow": "1.25rem",
    "--type-wordmark-size": "clamp(4rem, 16vw, 15rem)",
    // Layout of the site (px at 1440 in the comments; the study's measured numbers)
    "--site-header-height": "4.5625rem", // 73
    "--site-header-inset": "3.75rem", // 60
    "--site-header-inset-md": "2.5rem",
    "--site-header-inset-sm": "1.3125rem", // 21
    "--site-gutter-lg": "5rem", // 80
    "--site-gutter-md": "2.5rem", // 40
    "--site-gutter-sm": "1rem", // 16
    "--site-gutter-wide": "2.5rem", // 40, the plan grid
    "--site-gutter-inset": "1.25rem", // 20, inset panels
    "--site-gutter-inset-sm": "1rem",
    "--site-gutter-show": "4.25rem", // 68, showcase
    "--site-gutter-show-sm": "1.5rem", // 24
    "--site-gutter-panel": "3.8125rem", // 61: panel inset 20 + 61 = the measured column at 81
    "--site-gutter-panel-sm": "1.5625rem", // 25 (41 - 16)
    "--site-gutter-close": "1rem", // 16 + the closing column
    "--site-gutter-recipes-sm": "0.875rem", // 14, recipes grid at 390 px
    "--site-close-width": "27.5rem", // 440
    "--site-close-band": "35rem", // 560
    "--site-section-y": "6rem", // 96
    "--site-section-y-show": "5rem", // 80
    "--site-section-y-stage": "5rem", // 80
    "--site-section-y-stage-sm": "8rem", // 128
    "--site-section-y-stage-end": "1rem", // 16
    "--site-section-y-stage-end-sm": "6rem", // 96
    "--site-plans-end-sm": "1.375rem", // 22
    "--site-block-gap": "3rem", // 48
    "--site-title-gap": "0.75rem", // 12
    "--site-step-gap": "0.5rem", // 8
    "--site-feature-note": "8.75rem", // 140
    "--site-feature-gap": "3.75rem", // 60
    "--site-feature-gap-sm": "2rem", // 32
    "--site-feature-text": "26.25rem", // 420
    "--site-plan-gap": "1rem", // 16
    "--site-recipes-gap-sm": "1.125rem", // 18, recipes grid gaps at 390 px
    "--site-faq-gap": "13.5rem", // 216
    "--site-faq-gap-md": "6rem", // 96
    "--site-faq-gap-sm": "2.5rem", // 40
    "--site-faq-title": "22.125rem", // 354
    "--site-footer-brand": "25.6875rem", // 411
    "--site-footer-brand-md": "20.25rem", // 324
    "--site-footer-inset": "2.1875rem", // 35
    "--site-footer-inset-sm": "1.3125rem", // 21
    "--site-footer-gap-sm": "2.625rem", // 42
    "--site-footer-top": "5rem",
    "--site-platform-shot": "48.9375rem", // 783
    "--site-platform-width": "66.6875rem", // 1067
    "--site-platform-width-md": "45rem", // 720
    "--site-feature-text-md": "16rem",
    "--site-kinds-cover": "40rem",
    "--site-kinds-travel": "2700px",
    "--site-kinds-list": "22rem",
    "--site-shot-takes": "12rem",
    "--site-hero-end": "var(--site-section-y-show)",
    "--site-hero-top-sm": "clamp(5.5rem, 12vh, 7rem)",
    "--site-lyric-size": "clamp(1.5rem, 4vw, 2rem)",
    "--site-lane-height": "2.5rem",
    "--site-lane-label": "4.5rem",
    "--site-step-art": "8rem",
    "--site-out-cover": "4.5rem",
    "--site-shot-side": "14rem",
    "--site-mosaic-alpha": "0.35",
    "--site-close-size": "clamp(2.75rem, 7vw, 3.75rem)",
    "--site-footer-top-sm": "4rem",
    "--art-wave-bar": "2px",
    "--art-cover-ratio": "17 / 12",
    "--site-measure": "35rem", // 560
    "--site-hero-measure": "36rem",
    "--site-hero-top": "clamp(6.5rem, 15vh, 9rem)",
    "--site-hero-gap": "clamp(1.5rem, 5vh, 3rem)",
    "--site-studio-width": "52rem",
    "--site-card-min": "13rem",
    "--site-menu-row": "3.5rem",
    "--site-press-shift": "1px",
    "--site-lift": "-0.25rem",
    "--site-pixel": "1px",
    "--site-scroll-margin": "6rem",
    "--site-page-top": "10.5625rem", // 169: header 73 + 96, page head (pricing)
    "--site-page-top-sm": "7rem", // 112
    "--site-page-head-end": "1.5rem", // 24
    "--site-page-head-end-sm": "1.25rem", // 20
    "--site-plans-end": "7.5rem", // 120, under the plan grid
    "--site-faq-turn": "45deg", // the plus of an open question becomes a cross
    "--site-compare-min": "40rem", // 640: under this width the compare table scrolls inside its box
    "--site-desk-hero-top": "10.8125rem", // 173: desktop hero top inset
    "--site-desk-hero-end-sm": "4rem", // 64: desktop hero bottom inset at 390
    "--site-desk-frame-w": "66.0625rem", // 1057: desktop hero frame width at 1440
    "--site-desk-frame-w-md": "44.375rem", // 710: desktop hero frame width at 1024
    "--site-desk-shot": "48.4375rem", // 775: desktop hero screenshot column at 1440
    "--site-desk-included-copy": "33.6875rem", // 539: desktop included plan text column
    "--site-desk-included-card": "32.375rem", // 518: desktop included plan card width
    "--site-desk-included-pad": "1.75rem", // 28: desktop included plan card inner padding
    "--site-desk-included-col": "15.75rem", // 252: desktop included plan card first column
    "--site-desk-included-offset": "3.75rem", // 60: desktop included plan left offset (80 + 60 = 140)
    "--site-desk-included-end": "0.3125rem", // 5: aligns card inner grid left at 865
    "--site-desk-agents-text": "36.6875rem", // 587: desktop agents left text column at 1440
    "--site-desk-close-notes": "34.625rem", // 554: desktop closing notes row width at 1440
    "--site-desk-close-col": "18.6875rem", // 299: desktop closing notes first item width at 1440
    "--site-desk-platform-min": "36rem", // 576: under this width the platform table scrolls inside its box
    "--motion-step": "100ms",
    "--motion-rise": "0.75rem",
    "--layer-raised": "1",
    "--layer-header": "50",
    "--layer-skip": "60",
  },
});
