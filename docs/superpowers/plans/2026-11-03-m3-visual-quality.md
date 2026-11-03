# M3 Visual Quality and Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every rendered language version original, legible art and a render-specific quality decision before it can enter publishing.

**Architecture:** M2b's `TimelineVideo`, timeline schema and `timeline_patch` remain the only composition path. M3 adds a capped image router, render fingerprints, deterministic checks, a visual jury and database publish gate. The web editor writes the same append-only timeline revisions that agents write. All paid calls use M1's reservation and settlement layer.

**Tech Stack:** pnpm monorepo, Next.js 16, Node worker, Remotion player, Supabase Postgres, Python CPU tools, vitest, Playwright. Use the M2a `jury_reports`, `remake_analyses`, `stage_runs` and source `fingerprints`; use the M2b `timelines`, `TimelineVideo`, `timeline_get`, `timeline_patch` and `artefact_submit` contracts by those names.

**Spec:** `docs/superpowers/specs/2026-11-01-agentic-studio-design.md`, revision 6, especially 6.8, 8.4 R6-R8, 9.2-9.4, 10.1, 10.3-10.8, 11.3, 15.2 and 21.5. Read it beside this plan. M2a/M2b plans may still be in flight; reconcile their final file locations before implementation while preserving the named interfaces. This plan defines implementation signatures, not a claim that those files already exist.

## Global Constraints

- No em dash characters in code, copy, docs or commits. Plain commit messages, no co-author lines.
- Never spend kie, OpenRouter, Gemini or other paid credits in tests. Fake every provider and model response. Image generation in production is off until its owner gate and ledger price are present.
- Runtime images, models, caches, logs and test data live under `E:/mellodifai` or `G:/caches`, never C:. Stop if C: has less than 20 GB free. Never delete files not created by this work.
- Use the e2e stack only (Supabase API 45621, `E2E_PORT=3226` for this stream). Do not touch another worktree. Each migration is additive, has a database test, and takes an unused `20261103<NN>00XX` number. Proposed M3 prefix is `2026110303`; inspect `supabase/migrations` immediately before creating files and advance a collision without reusing a number.
- Every database operation uses the M1 `ops.*` wrapper pattern, role grants, idempotency and frozen error codes. Agent-facing writes carry their stated scope and no browser cookie is accepted by token routes.
- Keep untrusted meaning-map and blueprint strings as bounded data. The image container has no host secrets or files and no general network. Re-encode uploaded or generated images per 9.4.
- UI copy is Italian, with English through the existing i18n. Keep controls labelled for keyboard and computer-use agents.
- After each implementation task run its named test. Before merging run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm --filter @mellodifai/web exec tsc --noEmit`, `pnpm test`, `pnpm test:db`, `pnpm e2e`; database/e2e only on the e2e stack. Check visible UI at 1440x900 and 1360x600.

## Review Focus

1. A stale passing jury report for an earlier render must never make a new render publishable. Task 9 tests the render id and required report matrix.
2. A malicious meaning-map string must not cause route 2 to read a host file or contact an arbitrary URL. Task 4 runs a fake-container boundary test.
3. A timeout, refusal or usage limit must advance once to the next route, preserve caps and record provenance. Tasks 3-6 test the order and ledger outcomes.
4. Safe-area and OCR failures must be must-fix even if all judge scores are high. Tasks 7-8 test this.
5. Editing a scene must create a revision and a new preview/render without changing a published revision. Task 11 tests both UI and persistence.

---

## File Structure

| Area | Responsibility |
| --- | --- |
| `supabase/migrations/20261103030001_images.sql`, `20261103030002_image_prices.sql`, `20261103030003_brand_kit.sql`, `20261103030004_publish_gate.sql` | Image provenance, confirmed image prices, project brand kit, content kind and render-specific gate. Confirm numbers are free before writing. |
| `supabase/tests/m3_images.test.ts`, `m3_publish_gate.test.ts` | Database ownership, provenance, caps and gate matrix. |
| `packages/shared/src/images/` | Route order, bounded requests, result and provenance types. |
| `packages/gates/src/visual/`, `config/gates/visual.json` | Frozen rubric, thresholds, computed checks, distinctness and judge pins. |
| `apps/worker/src/images/`, `apps/worker/py/visual_fingerprints.py`, `apps/worker/py/visual_ocr.py` | Router, isolated route 2, local provider, CPU fingerprints and OCR. |
| `apps/worker/src/stages/art.ts`, `apps/worker/src/stages/visual-jury.ts` | R6 and R8 orchestration with existing stage registry. |
| `packages/visualizer/src/`, `apps/web/components/studio/video/`, `apps/web/app/actions/` | Thumbnail generation and the timeline editor over M2b's document. |
| `docs/design/motion-rules.md`, `docs/research/m3-image-prices.md` | Binding motion rules and dated route price decisions. |

## Step 1 - Image contract and provenance

### Task 1: Reserve image storage and the source-to-render fingerprint link

**Files:** Create `supabase/migrations/20261103030001_images.sql`, `supabase/tests/m3_images.test.ts`; modify `apps/worker/src/db.ts` and M1's `apps/web/lib/ops/defs/artefact-submit.ts` if that is the final artefact module.

**Interfaces:** `images(id, owner_id, version_id, shot_id, provider, model, prompt_hash, ledger_entry_id, path, sha256, metadata, created_at)`; `fingerprints(subject_kind, subject_id, shot_id, frame_index, phash, dinov2_embedding)` extends M2a's source table for render subjects. `saveImage(input: ImageProvenanceInput): Promise<string>` and `saveRenderFingerprints(renderId: string, rows: RenderFingerprint[]): Promise<void>` are owner-scoped worker DB methods. Image metadata repeats provider, model, prompt hash, ledger entry and hash without secrets.

- [ ] **Step 1: Write failing tests:** `m3_images.test.ts` cases `image insert requires matching owner and version`, `render fingerprints reject a foreign render`, `provenance row and file metadata have the same hash`, and `fingerprints distinguish source and render subjects`.
- [ ] **Step 2:** Run `pnpm test:db -- m3_images.test.ts`. Expected: FAIL because the tables/constraints are absent.
- [ ] **Step 3:** Implement additive DDL, indexes and exact `ops` grants per 6.3. Use M2a's existing source fingerprint key; never recreate its table. Add only methods needed by R6/R8.
- [ ] **Step 4:** Run `pnpm test:db -- m3_images.test.ts`. Expected: all four tests PASS, no real provider calls.
- [ ] **Step 5:** Commit `feat(m3): store image provenance and render fingerprints`.

### Task 2: Bounded request, re-encoding and route order

**Files:** Create `packages/shared/src/images/types.ts`, `packages/shared/src/images/request.ts`, `packages/shared/src/images/request.test.ts`, `apps/worker/src/images/accept.ts`, `apps/worker/test/image-accept.test.ts`; modify `packages/shared/src/index.ts`, `apps/web/next.config.ts` only if new relative `.js` imports require an alias.

**Interfaces:** `ImageRequest = { versionId: string; shotId: string; purpose: 'scene' | 'thumbnail'; palette: string; subject: string; mood: string; sectionId: string }`; `buildImagePrompt(input: ImageRequest): string` accepts only enums and bounded `Safe` fields, never a source frame or URL; `acceptImage(bytes: Uint8Array, mime: string): Promise<{ bytes: Uint8Array; sha256: string; width: number; height: number }>` enforces PNG/JPEG/WebP, 20 MB and 8192 px, strips metadata; `IMAGE_ROUTES = ['kie_midjourney', 'codex_gpt_image', 'gemini_nano_banana', 'openrouter', 'local_comfy'] as const`.

- [ ] **Step 1: Write failing tests:** `request.test.ts` cases `route order is exactly the owner order`, `prompt discards URLs and instructions in untrusted fields`, `one shot cannot exceed the bounded prompt`; `image-accept.test.ts` cases `rejects polyglot and oversize data`, `re-encode removes metadata`.
- [ ] **Step 2:** Run `pnpm --filter @mellodifai/shared exec vitest run src/images/request.test.ts` and `pnpm --filter @mellodifai/worker exec vitest run test/image-accept.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with existing image decode/encode dependencies and M2a's `Safe` conventions. Do not add a parser or image package if the repo already has one.
- [ ] **Step 4:** Run the same two commands. Expected: all named tests PASS.
- [ ] **Step 5:** Commit `feat(m3): define safe image requests and accepted files`.

## Step 2 - Routes and R6

### Task 3: Ledger-aware fallthrough router and Midjourney grid

**Files:** Create `apps/worker/src/images/router.ts`, `apps/worker/src/images/kie-midjourney.ts`, `apps/worker/test/image-router.test.ts`, `apps/worker/test/kie-midjourney.test.ts`; modify `apps/worker/src/providers/paid.ts`, M1's `price_book` seed migration through a new additive M3 migration only if a confirmed price exists.

**Interfaces:** `routeImage(request: ImageRequest, deps: { routes: ImageRoute[]; ledger: PaidCallLedger; now: () => Date }): Promise<ImageCandidate>`; `ImageRoute = { id: ImageRouteId; generate(request: ImageRequest, callKey: string): Promise<Uint8Array[]> }`; `generateMidjourneyGrid(request, callKey): Promise<Uint8Array[]>` returns four separately decoded candidates from one billed kie call. Reserve before the call, settle once, and use the M1 ambiguous-spend rule on uncertain outcomes. One Midjourney call per video and the 11.6 image allocation apply before calling the route.

- [ ] **Step 1: Write failing tests:** `image-router.test.ts` cases `tries Midjourney then codex then Nano Banana then OpenRouter then local`, `refusal timeout limit and spent allocation fall through in order`, `one accepted candidate settles one call and records provider`, `ambiguous Midjourney outcome does not retry its call key`; `kie-midjourney.test.ts` case `one fake call yields four candidates`.
- [ ] **Step 2:** Run `pnpm --filter @mellodifai/worker exec vitest run test/image-router.test.ts test/kie-midjourney.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement fake-injectable adapters. Keep route 1 disabled until the owner confirms access and a measured USD price is present in `price_book`; leave the manual `Importa da Midjourney` upload path available.
- [ ] **Step 4:** Run the same command. Expected: five tests PASS with fake HTTP; zero paid calls.
- [ ] **Step 5:** Commit `feat(m3): route image requests through capped providers`.

### Task 4: GPT Image in the isolated `mdf-img` container

**Files:** Create `ops/img-container.ts`, `ops/test/img-container.test.ts`, `apps/worker/src/images/codex-gpt-image.ts`, `apps/worker/test/codex-gpt-image.test.ts`; modify `ops/services.ts` for container lifecycle and `ops/edge-proxy.ts` for its allowlist only.

**Interfaces:** `runImageContainer(jobId: string, prompt: string): Promise<{ exitCode: number; files: Array<{ name: string; bytes: Uint8Array }>; stderr: string }>`; `generateCodexImage(request: ImageRequest, callKey: string): Promise<Uint8Array[]>`. `mdf-img` has a pinned image, its own login-only `CODEX_HOME`, an empty per-job output mount, read-only sandbox except that output, no approvals, no env files, no host mounts, and egress only to OpenAI/ChatGPT API hosts. Accept exactly one PNG/JPEG/WebP, then call `acceptImage`. Usage-limit nonzero exit marks exhaustion until the parsed reset or five hours; no image is a refusal.

- [ ] **Step 1: Write failing tests:** `img-container.test.ts` cases `mounts only login volume and empty output`, `denies non-API network and host file read for injected meaning map`; `codex-gpt-image.test.ts` cases `accepts exactly one re-encoded image`, `rejects extra output or executable`, `usage-limit exit records expiry`, `refusal falls through`.
- [ ] **Step 2:** Run `pnpm --filter @mellodifai/ops exec vitest run test/img-container.test.ts` and `pnpm --filter @mellodifai/worker exec vitest run test/codex-gpt-image.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the container invocation. The owner performs the one-time device login in its isolated volume; tests use a fake CLI and network spy. Production jobs take priority over the nightly loop on the shared ChatGPT quota.
- [ ] **Step 4:** Run both commands. Expected: all seven tests PASS; the injection test observes no unauthorized read or network request.
- [ ] **Step 5:** Commit `feat(m3): isolate GPT Image generation`.

### Task 5: Research and wire Nano Banana, OpenRouter and local fallback

**Files:** Create `docs/research/m3-image-prices.md`, `supabase/migrations/20261103030002_image_prices.sql`, `supabase/tests/m3_image_prices.test.ts`, `apps/worker/src/images/gemini-nano-banana.ts`, `apps/worker/src/images/openrouter.ts`, `apps/worker/src/images/local-comfy.ts`, `apps/worker/test/image-fallbacks.test.ts`, `config/gates/image-models.json`; modify `ops/services.ts` for the existing ComfyUI runtime.

**Interfaces:** `generateNanoBanana(request, callKey): Promise<Uint8Array[]>`, `generateOpenRouterImage(request, callKey): Promise<Uint8Array[]>`, `generateLocalImage(request, callKey): Promise<Uint8Array[]>`. Nano Banana is disabled until a dated official free-tier limit and paid price are recorded in `price_book`; OpenRouter accepts only allowlisted models with a price-book row; local route never falls back to a paid route. `selectLocalImageModel(scores: LocalBakeoffScore[]): string` chooses the T18 winner from fixed fixture prompts and records its version.

- [ ] **Step 1: Write failing tests:** `image-fallbacks.test.ts` cases `unknown Nano Banana price keeps route off`, `unpriced OpenRouter model is refused`, `local fallback makes no paid call`, `T18 bake-off selects the recorded winner and keeps provenance`.
- [ ] **Step 2:** Run `pnpm --filter @mellodifai/worker exec vitest run test/image-fallbacks.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Record source URL, access date, currency and unit price in the research file; use official price and limit evidence. Run the same fixed scene and thumbnail fixtures through available local models without paid calls, recording quality and latency. Do not assume a model or price.
- [ ] **Step 4:** Run the test command and `pnpm test:db -- m3_image_prices.test.ts`. Expected: four worker tests PASS; the database test confirms only sourced prices are seeded and unknown prices leave routes off.
- [ ] **Step 5:** Commit `feat(m3): add priced and local image fallbacks`.

### Task 6: R6 images and candidate selection

**Files:** Create `apps/worker/src/stages/art.ts`, `apps/worker/test/art.test.ts`; modify the worker stage registry, `apps/worker/src/db.ts`, `apps/web/app/actions/visualizer.ts` only for the manual Midjourney import control, and M2b's timeline asset writer.

**Interfaces:** `art: StageHandler` reads M2a's blueprint and meaning map, requests images only where `imageNeed !== 'none'`, generates at most eight scene images and three thumbnail candidates in standard tier, stores `images` provenance, and patches asset refs through M2b's timeline revision API. `chooseImageCandidate(candidates: ImageCandidate[], scores: VisualCandidateScore[]): ImageCandidate` chooses a passing candidate and preserves all scores in `jury_reports`.

- [ ] **Step 1: Write failing tests:** `art.test.ts` cases `skips shots with no image need`, `uses at most eight scene images and three thumbnail candidates`, `candidate scores select the highest passing image`, `manual MJ import is re-encoded and never bills kie`, `asset refs point only to accepted images`.
- [ ] **Step 2:** Run `pnpm --filter @mellodifai/worker exec vitest run test/art.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Wire R6 to M2a's `stage_runs` stop/round machinery and M2b's validated timeline revision writer; preserve ledger call keys across retries.
- [ ] **Step 4:** Run the command. Expected: five tests PASS on fake providers.
- [ ] **Step 5:** Commit `feat(m3): attach judged images to timeline scenes`.

## Step 3 - Visual quality and publish gate

### Task 7: Motion rules, deterministic checks and render fingerprints

**Files:** Create `docs/design/motion-rules.md`, `packages/gates/src/visual/checks.ts`, `packages/gates/src/visual/checks.test.ts`, `apps/worker/py/visual_fingerprints.py`, `apps/worker/py/visual_ocr.py`, `apps/worker/test/visual-fingerprints.test.ts`; modify `packages/visualizer/src/TimelineVideo.tsx` and its block components only where a rule fails.

**Interfaces:** `checkVisualRules(input: VisualCheckInput): VisualCheckResult` checks 4.5:1 contrast, 3:1 at 48 px+, 90% title safe for 16:9, bottom 20% and right 12% Shorts exclusion, minimum type size, lyric duration plus 0.2 s lead, and one-frame tolerance for `cutOnBeat`. `fingerprintRender(renderId, framePaths): Promise<RenderFingerprint[]>` runs CPU pHash and DINOv2 at the same section-relative shot positions as M2a source fingerprints. `scanText(framePaths, expected): Promise<OcrFinding[]>` uses Tesseract 5 with `jpn` and `chi_sim` data. Document slot-locked numbers, seamless loops, rest legibility, fixed easing, safe margins and `typeScale`.

- [ ] **Step 1: Write failing tests:** `checks.test.ts` cases `contrast and both safe-area rules fail`, `lyric line shorter than sung duration plus lead fails`, `cutOnBeat outside one frame fails`; `visual-fingerprints.test.ts` cases `same shot-relative sample aligns source and render`, `garbled Japanese and Chinese text is reported`.
- [ ] **Step 2:** Run `pnpm --filter @mellodifai/gates exec vitest run src/visual/checks.test.ts` and `pnpm --filter @mellodifai/worker exec vitest run test/visual-fingerprints.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Adapt the owner's deck playbook at the path in 10.7 into `motion-rules.md`; make checks executable. Store fingerprints by render id, never by version alone. Pin CPU Python requirements in M2a's requirements file.
- [ ] **Step 4:** Run both commands. Expected: five tests PASS, including OCR fixtures.
- [ ] **Step 5:** Commit `feat(m3): enforce visual motion rules and fingerprints`.

### Task 8: Visual jury, originality, distinctness and thumbnails

**Files:** Create `config/gates/visual.json`, `packages/gates/src/visual/jury.ts`, `packages/gates/src/visual/jury.test.ts`, `apps/worker/src/stages/visual-jury.ts`, `apps/worker/test/visual-jury.test.ts`, `packages/visualizer/src/Thumbnail.tsx`, `packages/visualizer/test/thumbnail.test.tsx`; modify the worker stage registry, `apps/web/lib/studio/clips.ts` and `apps/web/components/studio/feed/jury-panel.tsx`.

**Interfaces:** `judgeVisualRound(input: VisualJuryInput, round: 1 | 2 | 3): Promise<VisualJuryReport>` sends at most four images per judge: two 3x4 frame grids at 1536 px long side, the contact sheet and a 320x180 thumbnail grid. Rounds 1-2 use pinned `google/gemini-3.8-flash`; round 3 adds pinned `anthropic/claude-haiku-5.5`. `evaluateVisualGate(reports, checks, originality, distinctness): GateDecision` requires median at least 0.7 for all seven 10.4 criteria, no must-fix, visual pHash distance at least 12 and DINOv2 cosine at most 0.85, distinctness max at most 0.95 and mean at most 0.92 against last 20 published renders, and a look used at most twice in the last five. Thumbnail rule: one focal subject, at most three words, readable at 320x180, high contrast, consistent style and no misleading claim. Persist model ids, rubric version, availability and pass per render in `jury_reports`; retry/fix/re-render at most three rounds.

- [ ] **Step 1: Write failing tests:** `jury.test.ts` cases `median and every criterion threshold apply`, `OCR and safe-area must-fix override high scores`, `both final judges must flag an AI artefact`, `unavailable judge stops the run`, `distinctness checks maximum mean and look reuse`; `visual-jury.test.ts` cases `judge sees only four sized images`, `three rounds end without a passing report`; `thumbnail.test.tsx` cases `four-word and misleading thumbnails fail`, `three candidate grid renders at phone size`.
- [ ] **Step 2:** Run `pnpm --filter @mellodifai/gates exec vitest run src/visual/jury.test.ts`, `pnpm --filter @mellodifai/worker exec vitest run test/visual-jury.test.ts`, and `pnpm --filter @mellodifai/visualizer exec vitest run test/thumbnail.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement with fake judge responses. Move the clip read from `versions.lyric_jury` to `jury_reports`, retaining the M2a dual-write until a later human-written drop migration. Keep `config/gates` on the loop denylist. Calibrate against M2a's golden fixtures; automatically tighten only. A looser originality threshold is an owner decision.
- [ ] **Step 4:** Run all three commands. Expected: nine tests PASS, zero paid model calls.
- [ ] **Step 5:** Commit `feat(m3): judge renders and thumbnail candidates`.

### Task 8a: T15 project brand kit without built-in marks

**Files:** Create `supabase/migrations/20261103030003_brand_kit.sql`, `supabase/tests/m3_brand_kit.test.ts`, `packages/shared/src/images/brand-kit.ts`, `packages/shared/src/images/brand-kit.test.ts`, `apps/web/components/studio/video/brand-kit.tsx`, `apps/web/components/studio/video/brand-kit.test.tsx`; modify `apps/web/app/(app)/projects/[id]/page.tsx`, `apps/web/lib/studio/i18n.ts`, `apps/worker/src/stages/art.ts`, `packages/visualizer/src/Thumbnail.tsx`.

**Interfaces:** `BrandKit = { palette: string[]; font: string; typeScale: number; logos: Array<{ imageId: string; corner: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right'; size: number; opacity: number }> }`; `saveBrandKit(projectId: string, kit: BrandKit): Promise<void>` is an owner-scoped `ops` write to `projects.brand_kit`. `resolveBrandKit(project, version): BrandKit` supplies R6, thumbnail and timeline defaults. Fonts and logos use the existing T28 allowlists and limits; absence means no logo. No app name, trumpet or gramophone is inserted automatically.

- [ ] **Step 1: Write failing tests:** `m3_brand_kit.test.ts` cases `foreign project cannot update kit`, `unknown image and a third logo fail`; `brand-kit.test.ts` cases `font and palette are bounded`, `empty kit produces no built-in marks`; UI test `palette font and two logo controls save and preview in the selected project`.
- [ ] **Step 2:** Run `pnpm test:db -- m3_brand_kit.test.ts`, `pnpm --filter @mellodifai/shared exec vitest run src/images/brand-kit.test.ts`, and `pnpm --filter @mellodifai/web exec vitest run components/studio/video/brand-kit.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement a small project-level kit and reuse T28 logo controls. Feed the same values to R6, the visual jury's brand-fit criterion, thumbnail rendering and the timeline's `typeScale`.
- [ ] **Step 4:** Run all three commands. Expected: five tests PASS, with no built-in branding in an empty kit.
- [ ] **Step 5:** Commit `feat(m3): add a project brand kit`.

### Task 9: Render-specific database publish gate

**Files:** Create `supabase/migrations/20261103030004_publish_gate.sql`, `supabase/tests/m3_publish_gate.test.ts`; modify M1's `ops.video_approve` and `ops.enqueue_publish` definitions and `apps/web/components/studio/feed/clip-card.tsx` for the recorded Copilot override reason. M4 adds the same check to its new `ops.schedule_publish`.

**Interfaces:** `versions.content_kind` is set by the creating RPC to one of `remake | idea | import | lyric_video | visualizer`; no client may change it. `ops.publish_gate_status(p_render uuid)` returns `{ report: string; status: 'missing' | 'unavailable' | 'failed' }[]` for the exact render. Required matrix: remake = QA, lyric jury, lyric originality, visual jury, visual originality, distinctness, thumbnail; idea = QA, lyric jury, visual jury, distinctness, thumbnail; import/lyric_video/visualizer = QA, visual jury, distinctness, thumbnail. `ops.video_approve(p_render uuid, p_override_reason text default null)`, `ops.enqueue_publish(p_render uuid)`, and later `ops.schedule_publish(p_render uuid, ...)` fail while the list is nonempty. A nonempty reason allows only a cookie-authenticated Copilot person to approve, writes an audit row, and displays it; token and Autopilot paths have no override.

- [ ] **Step 1: Write failing tests:** `m3_publish_gate.test.ts` cases `each of five kinds has exactly its required report set`, `unavailable and failed count as missing pass`, `old render reports do not clear new render`, `video_approve and enqueue_publish refuse missing reports`, `cookie Copilot override records reason`, `token and Autopilot cannot override`, `only creating RPC sets content_kind`.
- [ ] **Step 2:** Run `pnpm test:db -- m3_publish_gate.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement additive DDL and wrappers with M1 role discipline and frozen errors. Keep M4's `schedule_publish` gate enforcement in the M4 migration if that function does not exist yet.
- [ ] **Step 4:** Run the command. Expected: seven tests PASS. Re-run existing `approve_video` and publish database tests.
- [ ] **Step 5:** Commit `feat(m3): require passing reports for each render`.

## Step 4 - Timeline editor and exit

### Task 10: Timeline read/write operations for the web editor

**Files:** Create `apps/web/lib/studio/timeline-editor.ts`, `apps/web/lib/studio/timeline-editor.test.ts`; modify `apps/web/app/actions/visualizer.ts`, M2b's `apps/web/lib/ops/defs/timeline-patch.ts`, and `packages/shared/src/timeline/blocks.ts` only if a missing bounded parameter is needed.

**Interfaces:** `getTimelineEditor(versionId: string): Promise<{ revision: number; document: TimelineDocument; takeWaveform: number[] }>`; `saveTimelineEdit(versionId: string, expectedRevision: number, patch: TimelinePatch): Promise<{ revision: number }>` calls M2b `timeline_patch` with optimistic revision, server validation and author stamp. Allowed patches only retime boundaries, text, block look/params and asset ref; no keyframes, code, CSS or URL. A successful edit queues a preview/rerender for the new revision.

- [ ] **Step 1: Write failing tests:** `timeline-editor.test.ts` cases `edit appends revision and leaves old revision intact`, `stale expectedRevision conflicts`, `invalid asset or URL is rejected`, `edit queues preview of the new revision only`.
- [ ] **Step 2:** Run `pnpm --filter @mellodifai/web exec vitest run lib/studio/timeline-editor.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Use M2b's validators and `timeline_patch`; do not add a second timeline schema or direct table write.
- [ ] **Step 4:** Run the command. Expected: four tests PASS.
- [ ] **Step 5:** Commit `feat(m3): connect timeline editor to versioned patches`.

### Task 11: Project timeline UI and R6-R8 exit run

**Files:** Create `apps/web/components/studio/video/timeline-editor.tsx`, `apps/web/components/studio/video/timeline-editor.test.tsx`, `apps/web/e2e/m3-timeline.spec.ts`, `apps/worker/test/remake-r6-r8.test.ts`; modify `apps/web/app/(app)/projects/[id]/page.tsx`, `apps/web/lib/studio/i18n.ts`, `apps/web/components/studio/video/visualizer-preview.tsx`.

**Interfaces:** `<TimelineEditor versionId: string initial: TimelineEditorState />` shows scenes over the chosen take waveform, drag handles for scene boundaries, text and block look/param inputs, asset picker and `@remotion/player` preview. Every action has an Italian accessible label and English dictionary entry. The preview uses the exact M2b `TimelineVideo` composition and current revision.

- [ ] **Step 1: Write failing tests:** `timeline-editor.test.tsx` cases `drag retimes only the selected boundary`, `text look and asset edits show in player and save a new revision`, `keyboard controls and Italian labels work`, `no keyframe control exists`; `m3-timeline.spec.ts` case `editing a scene at 1440x900 and 1360x600 preserves visible controls and previews the new revision`.
- [ ] **Step 2:** Run `pnpm --filter @mellodifai/web exec vitest run components/studio/video/timeline-editor.test.tsx` and `E2E_PORT=3226 pnpm --filter @mellodifai/web exec playwright test e2e/m3-timeline.spec.ts` on the e2e stack. Expected: FAIL.
- [ ] **Step 3:** Implement the project view. Run the full R6-R8 fixture with fake providers: a typo and unsafe text must fail, repaired render must pass, and `approve_video` must reject an incomplete report set. Save both viewport screenshots under the workstream's `shots/` directory.
- [ ] **Step 4:** Run both commands, `pnpm test:db -- m3_publish_gate.test.ts`, and the fixture integration test `pnpm --filter @mellodifai/worker exec vitest run test/remake-r6-r8.test.ts`. Expected: all PASS, no paid credits and two screenshots reviewed.
- [ ] **Step 5:** Commit `feat(m3): add timeline editor and verify visual workflow`.

## Requirement to task self-review

| Design requirement | Task and proving test |
| --- | --- |
| 9.4 safe image submission and provenance, 15.2 `images` | 1-2, `m3_images`, `image-accept` |
| 11.3 exact five-route order, price and cap fallthrough | 2-5, `image-router`, `image-fallbacks` |
| 11.3 sandboxed ChatGPT subscription route and injection boundary | 4, `img-container`, `codex-gpt-image` |
| T18 local model choice and T15 brand kit/fit | 5, 8 and 8a, `image-fallbacks`, `jury`, `m3_brand_kit` |
| R6 eight scene images, three thumbnail candidates, manual MJ import | 6, `art` |
| 10.7 motion rules and 10.4 computed checks | 7, `checks` |
| 10.3 render fingerprints and original visuals | 1, 7-8, `visual-fingerprints`, `jury` |
| 10.4 visual jury, OCR, 3 rounds, unavailable fails | 8, `jury`, `visual-jury` |
| 10.6 distinctness against 20 videos and look reuse | 8, `jury` |
| 10.8 content-kind matrix, render-specific publish gate and override | 9, `m3_publish_gate` |
| 9.2, 21.5 web editor with M2b timeline and no keyframes | 10-11, `timeline-editor`, `m3-timeline` |
| 21.5 exit: R6/R8 fixture, typo, safe-area, gate, route fallthrough | 3-4, 7-9, 11, named tests above and `remake-r6-r8` |
