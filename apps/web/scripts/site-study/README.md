# Site Study Judge Scripts (J1, J2, J6)

Clean-room structural layout and guard tools for public site pages (`apps/web/app/(site)/`).
These scripts measure DOM structure and geometry only (section order, content column gutters,
insets, and main grid). No reference text, media, logo, fonts, or code is stored or compared.

## Scripts

- `measure.mjs` - opens a running site page in Playwright Chromium at `1440x900`, `1024x768`,
  and `390x844`, writes `layout-ref.json`, and draws deterministic 8-bit greyscale layout strips
  (`strips/<width>/<NN>.png`).
- `layout-diff.mjs` - **J1 numeric judge**: compares two `layout-ref.json` files (or folders)
  value by value within a pixel tolerance (default `--px=4`). Exits non-zero on failure.
- `judge-strips.mjs` - **J2 strip judge**: renders fresh layout strips from reference and
  candidate `layout-ref.json` files into a temporary directory and compares every section strip
  with `craft-anything-cli --clean-room web-pixels-compare` (default `--max=0.01`,
  `--tolerance=8`). Exits non-zero on failure or missing CLI.
- `guard.mjs` - **J6 clean-room guard**: checks for forbidden reference tokens, verifies
  `apps/web/public/site/assets.manifest.json`, and checks recipe copy against captured reference
  word runs when available.

## J2 Prerequisites (Local Machine Only)

J2 requires **Craft Anything CLI `0.6.1`** (`craft-anything-cli` / `craft-anything-cli.exe`).
It is **not** committed to this repository and `pnpm install` does **not** install it.

- **Local only:** J2 runs on a developer or lab machine that has `craft-anything-cli` installed.
  CI does not install Craft Anything and does not run J2; the real-CLI test in
  `judge-strips.test.ts` is marked skipped when `CRAFT_ANYTHING_CLI` is not set.
- **Where to get it:** download release `v0.6.1` from
  <https://github.com/storytold/craft-anything/releases/tag/v0.6.1> (for Windows x64, use
  `craft-anything-0.6.1-windows-x64-portable.zip` and extract `craft-anything-cli.exe`; macOS
  and Linux archives are published on the same release page with `SHA256SUMS.txt`).
- **How to point J2 at the binary:** set `CRAFT_ANYTHING_CLI` to the executable path, pass
  `--cli <path>`, or place `craft-anything-cli` on `PATH`. On Windows, point directly to
  `craft-anything-cli.exe` (`.cmd` and `.bat` shims are rejected).

## Running J1 and J2 Against a Local Prod Build

Start a local production build of `@mellodifai/web` (for example on `SITE_BASE_URL=http://127.0.0.1:3242`),
then run one-page J1 + J2:

```bash
export SITE_BASE_URL=http://127.0.0.1:3242
export CRAFT_ANYTHING_CLI=/path/to/craft-anything-cli
pnpm judge:j2 home
pnpm judge:j2 pricing
pnpm judge:j2 recipes
pnpm judge:j2 recipes-grid
```

Or run the three scripts step by step:

```bash
node apps/web/scripts/site-study/measure.mjs --base "$SITE_BASE_URL" --route /pricing --slug pricing --out /tmp/site-judge/pricing
node apps/web/scripts/site-study/layout-diff.mjs apps/web/e2e/site/layout-ref/pricing.json /tmp/site-judge/pricing/layout-ref.json --px=4
node apps/web/scripts/site-study/judge-strips.mjs apps/web/e2e/site/layout-ref/pricing.json /tmp/site-judge/pricing --max=0.01 --tolerance=8
```
