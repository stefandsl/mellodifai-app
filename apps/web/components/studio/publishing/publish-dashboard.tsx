"use client";
import {
  type DraftFields,
  type LintIssue,
  lintYouTubeDraft,
  MOBILE_TITLE_CHARS,
  PLATFORM_LABELS,
  SOON_PLATFORMS,
} from "@mellodifai/shared";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  cancelPublication,
  reopenPublication,
  vetoLegacyPublication,
  decidePublication,
  editPublicationDraft,
  planPublication,
  requestPublication,
  setPublicationSlot,
  vetoPublication,
} from "@/app/actions/publishing";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useLocale } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/use-action";
import type { ActionResult } from "@/lib/action-result";
import type { LegacySchedule, ScheduleView } from "@/lib/ops/defs/publishing";
import { pt } from "./copy";

const OPEN = ["draft", "awaiting_approval", "scheduled", "publishing", "held"];
const EDITABLE = ["draft", "awaiting_approval", "rejected", "expired"];
const VETO = ["awaiting_approval", "scheduled", "publishing", "held"];
const CANCEL = [
  "draft",
  "awaiting_approval",
  "rejected",
  "expired",
  "held",
  "vetoed",
];
const ROME = "Europe/Rome";

export function romeTime(iso: string, lang: "it" | "en") {
  return new Intl.DateTimeFormat(lang === "it" ? "it-IT" : "en-GB", {
    timeZone: ROME,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

// A slot as the datetime-local input shows it, in Rome time.
function romeInput(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: ROME,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// The datetime-local value read as Rome time, whatever the browser's own zone is.
export function romeToIso(local: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as number[];
  const guess = Date.UTC(y as number, (mo as number) - 1, d, h, mi);
  const shown = romeInput(new Date(guess).toISOString());
  const [, sy, smo, sd, sh, smi] = (
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(shown) ?? []
  ).map(Number) as number[];
  const offset =
    Date.UTC(sy as number, (smo as number) - 1, sd, sh, smi) - guess;
  return new Date(guess - offset).toISOString();
}

function left(ms: number, lang: "it" | "en") {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const text =
    days > 0
      ? `${days}g ${hours}h`
      : hours > 0
        ? `${hours}h ${rest}m`
        : `${rest}m`;
  return pt(lang, "left", {
    time: lang === "en" ? text.replace("g", "d") : text,
  });
}

function issueText(
  lang: "it" | "en",
  issue: LintIssue | { field: string; code: string; limit?: number },
) {
  return pt(lang, `lint.${issue.code}`, {
    field: pt(lang, `field.${issue.field}`),
    limit: issue.limit ?? "",
  });
}

// The worker stores a short code; the owner reads a sentence, never raw provider text.
const ERROR_CODES = [
  "provider_error",
  "set_public_failed",
  "metadata_update_failed",
];
const errorText = (lang: "it" | "en", code: string) =>
  pt(
    lang,
    code.startsWith("lost_handoff")
      ? "error.lost_handoff"
      : `error.${ERROR_CODES.includes(code) ? code : "provider_error"}`,
  );

const toDraft = (
  view: ScheduleView | null,
  fallback: DraftFields,
): DraftFields => view?.destinations[0]?.draft ?? fallback;

export function PublishDashboard({
  versionId,
  songTitle,
  canPublish,
  thumbnailUrl,
  defaults,
  current,
  past,
  legacy = [],
}: {
  versionId: string;
  songTitle: string;
  canPublish: boolean;
  thumbnailUrl: string | null;
  defaults: DraftFields;
  current: ScheduleView | null;
  past: ScheduleView[];
  legacy?: LegacySchedule[];
}) {
  const lang = useLocale();
  const router = useRouter();
  const { pending, run } = useAction();
  const [draft, setDraft] = useState<DraftFields>(toDraft(current, defaults));
  const [tagsText, setTagsText] = useState(draft.tags.join(", "));
  const [slot, setSlot] = useState(
    current?.slot_at ? romeInput(current.slot_at) : "",
  );
  // Client clock only: a server-rendered countdown would not match the hydrated one.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  // A server refresh (approval, veto, worker progress) brings a new draft and slot.
  useEffect(() => {
    const next = toDraft(current, defaults);
    setDraft(next);
    setTagsText(next.tags.join(", "));
    setSlot(current?.slot_at ? romeInput(current.slot_at) : "");
  }, [current, defaults]);

  const lint = useMemo(() => lintYouTubeDraft(draft), [draft]);
  const saved = toDraft(current, defaults);
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  // Problems only the server can see (the base thumbnail in Storage), for the saved draft.
  const serverErrors = dirty
    ? []
    : (current?.destinations[0]?.problems ?? []).filter(
        (issue) => issue.code === "no_base_image",
      );
  const errors = [...lint.errors, ...serverErrors];
  const state = current?.state;
  const editable = !!state && EDITABLE.includes(state);
  const destination = current?.destinations[0];
  const refresh = (done?: string) => () => {
    if (done) toast.success(done);
    router.refresh();
  };
  const step = async (result: ActionResult) => {
    if (!result.ok) throw Object.assign(new Error(result.error), { result });
    return result;
  };

  const schedule = () =>
    run(
      async (): Promise<ActionResult> => {
        if (!current) return { ok: false, error: pt(lang, "notReady") };
        const iso = romeToIso(slot);
        try {
          if (dirty)
            await step(
              await editPublicationDraft({
                schedule_id: current.schedule_id,
                platform: "youtube",
                draft,
              }),
            );
          if (!iso)
            return {
              ok: false,
              error: pt(lang, "lint.invalid", { field: pt(lang, "slot") }),
            };
          if (
            !current.slot_at ||
            Date.parse(iso) !== Date.parse(current.slot_at)
          )
            await step(
              await setPublicationSlot({
                schedule_id: current.schedule_id,
                slot_at: iso,
              }),
            );
          return await requestPublication({ schedule_id: current.schedule_id });
        } catch (error) {
          return (
            (error as { result?: ActionResult }).result ?? {
              ok: false,
              error: String(error),
            }
          );
        }
      },
      refresh(pt(lang, "scheduled")),
    );

  return (
    <div className="grid gap-6">
      <section aria-labelledby="pub-platforms">
        <h2 id="pub-platforms" className="mb-3 text-lg font-medium">
          {pt(lang, "platforms")}
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <li>
            <Card size="sm" className="h-full ring-2 ring-[var(--brand)]">
              <CardContent className="grid gap-1">
                <span className="flex items-center justify-between gap-2 font-medium">
                  {PLATFORM_LABELS.youtube}
                  <Badge>{pt(lang, "active")}</Badge>
                </span>
                <span className="text-xs text-muted-foreground">
                  {state ? pt(lang, `state.${state}`) : pt(lang, "youtubeHint")}
                </span>
              </CardContent>
            </Card>
          </li>
          {SOON_PLATFORMS.map((platform) => (
            <li key={platform}>
              <Card
                size="sm"
                aria-disabled="true"
                className="h-full opacity-60"
              >
                <CardContent className="flex items-center justify-between gap-2">
                  <span>{PLATFORM_LABELS[platform]}</span>
                  <Badge variant="outline">{pt(lang, "soon")}</Badge>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {!canPublish ? (
        <p className="text-muted-foreground">{pt(lang, "notReady")}</p>
      ) : null}
      {canPublish && (!current || !OPEN.includes(current.state)) ? (
        <div>
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  planPublication({
                    version_id: versionId,
                    platforms: ["youtube"],
                    draft: defaults,
                  }),
                refresh(),
              )
            }
          >
            {current ? pt(lang, "newPlan") : pt(lang, "start")}
          </Button>
        </div>
      ) : null}
      {current ? (
        <>
          {current.approval?.state === "pending" ? (
            <Card
              role="region"
              aria-label={pt(lang, "approvalTitle")}
              className="ring-2 ring-amber-500/70"
            >
              <CardHeader>
                <CardTitle>{pt(lang, "approvalTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-sm text-muted-foreground">
                  {pt(lang, "approvalHint")}
                </p>
                <p>{current.approval.summary}</p>
                <p className="text-sm">
                  {pt(lang, "price", {
                    price: current.approval.price_eur.toFixed(2),
                  })}
                  {" · "}
                  {pt(lang, "requestedVia", {
                    via: pt(lang, `via.${current.approval.requested_via}`),
                  })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          decidePublication({
                            approvalId: current.approval?.approval_id,
                            decision: "approve",
                          }),
                        refresh(pt(lang, "scheduled")),
                      )
                    }
                  >
                    {pt(lang, "approve")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          decidePublication({
                            approvalId: current.approval?.approval_id,
                            decision: "reject",
                          }),
                        refresh(),
                      )
                    }
                  >
                    {pt(lang, "reject")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card role="region" aria-label={pt(lang, "status")}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-3">
                {pt(lang, "status")}
                <Badge variant="secondary" data-testid="publish-state">
                  {pt(lang, `state.${current.state}`)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {current.held_reason ? (
                <p className="text-sm">
                  {pt(lang, `held.${current.held_reason}`)}
                </p>
              ) : null}
              {current.slot_at && OPEN.includes(current.state) ? (
                current.veto_open ? (
                  <p className="text-sm" data-testid="veto-deadline">
                    {pt(lang, "vetoUntil", {
                      time: romeTime(current.slot_at, lang),
                    })}
                    {now === null
                      ? null
                      : ` · ${left(Date.parse(current.slot_at) - now, lang)}`}
                  </p>
                ) : (
                  <p className="text-sm">{pt(lang, "vetoClosed")}</p>
                )
              ) : null}
              {current.media ? (
                <p className="text-sm text-muted-foreground">
                  {pt(lang, "media", {
                    state: pt(
                      lang,
                      current.media.state === "uploading"
                        ? "privacy.uploading"
                        : `privacy.${current.media.privacy ?? "private"}`,
                    ),
                  })}
                </p>
              ) : null}
              {destination?.external_url ? (
                <a
                  className="text-sm text-[var(--brand)] underline-offset-4 hover:underline"
                  href={destination.external_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {pt(lang, "link")}
                </a>
              ) : null}
              {destination?.error ? (
                <p
                  className="text-sm text-destructive"
                  data-testid="destination-error"
                >
                  {errorText(lang, destination.error)}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {VETO.includes(current.state) && current.veto_open ? (
                  <ConfirmDialog
                    trigger={pt(lang, "veto")}
                    title={pt(lang, "veto")}
                    onConfirm={async () => {
                      const result = await vetoPublication({
                        schedule_id: current.schedule_id,
                      });
                      if (result.ok) refresh(pt(lang, "vetoDone"))();
                      return result;
                    }}
                  >
                    {pt(lang, "vetoConfirm")}
                  </ConfirmDialog>
                ) : null}
                {current.state === "held" ? (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          reopenPublication({
                            schedule_id: current.schedule_id,
                          }),
                        refresh(pt(lang, "reopened")),
                      )
                    }
                  >
                    {pt(lang, "reopen")}
                  </Button>
                ) : null}
                {CANCEL.includes(current.state) ? (
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          cancelPublication({
                            schedule_id: current.schedule_id,
                          }),
                        refresh(),
                      )
                    }
                  >
                    {pt(lang, "cancel")}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card role="region" aria-label={pt(lang, "pairing")}>
            <CardHeader>
              <CardTitle>{pt(lang, "pairing")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <fieldset
                disabled={!editable || pending}
                className="grid min-w-0 gap-4"
              >
                <p className="text-sm text-muted-foreground">
                  {pt(lang, "pairingHint")}
                </p>
                <div className="grid gap-2">
                  <Label htmlFor="pub-title">{pt(lang, "fieldTitle")}</Label>
                  <Input
                    id="pub-title"
                    value={draft.title}
                    onChange={(event) =>
                      setDraft({ ...draft, title: event.target.value })
                    }
                  />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {draft.title.length}/100
                  </span>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="pub-thumb">{pt(lang, "fieldThumb")}</Label>
                  <Input
                    id="pub-thumb"
                    value={draft.thumbnail_text}
                    onChange={(event) =>
                      setDraft({ ...draft, thumbnail_text: event.target.value })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="pub-description">
                    {pt(lang, "fieldDescription")}
                  </Label>
                  <Textarea
                    id="pub-description"
                    rows={6}
                    value={draft.description}
                    onChange={(event) =>
                      setDraft({ ...draft, description: event.target.value })
                    }
                  />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {draft.description.length}/5000
                  </span>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="pub-tags">{pt(lang, "fieldTags")}</Label>
                  <Input
                    id="pub-tags"
                    value={tagsText}
                    onChange={(event) => {
                      setTagsText(event.target.value);
                      setDraft({
                        ...draft,
                        tags: event.target.value
                          .split(",")
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      });
                    }}
                  />
                </div>
                {errors.length ? (
                  <div
                    role="alert"
                    data-testid="lint-errors"
                    className="grid gap-1 text-sm text-destructive"
                  >
                    <strong>{pt(lang, "problems")}</strong>
                    {errors.map((issue) => (
                      <span key={`${issue.field}-${issue.code}`}>
                        {issueText(lang, issue)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {lint.warnings.length ? (
                  <div
                    className="grid gap-1 text-sm text-muted-foreground"
                    data-testid="lint-warnings"
                  >
                    <strong>{pt(lang, "warnings")}</strong>
                    {lint.warnings.map((issue) => (
                      <span key={`${issue.field}-${issue.code}`}>
                        {issueText(lang, issue)}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <Label htmlFor="pub-slot">{pt(lang, "slot")}</Label>
                  <Input
                    id="pub-slot"
                    type="datetime-local"
                    value={slot}
                    onChange={(event) => setSlot(event.target.value)}
                    className="max-w-64"
                  />
                  <span className="text-xs text-muted-foreground">
                    {pt(lang, "slotHint")}
                  </span>
                </div>
                {/* A scheduled plan changes only after a veto: no dead buttons. */}
                <div className={editable ? "flex flex-wrap gap-2" : "hidden"}>
                  <Button
                    variant="outline"
                    disabled={!dirty || lint.errors.length > 0}
                    onClick={() =>
                      run(
                        () =>
                          editPublicationDraft({
                            schedule_id: current.schedule_id,
                            platform: "youtube",
                            draft,
                          }),
                        refresh(pt(lang, "saved")),
                      )
                    }
                  >
                    {pt(lang, "save")}
                  </Button>
                  <Button
                    disabled={!slot || errors.length > 0}
                    onClick={schedule}
                  >
                    {pt(lang, "schedule")}
                  </Button>
                </div>
              </fieldset>
              <figure
                aria-label={pt(lang, "preview")}
                className="grid content-start gap-2"
              >
                <figcaption className="text-xs text-muted-foreground">
                  {pt(lang, "preview")}
                </figcaption>
                <div className="mx-auto w-full max-w-[18rem] rounded-[1.75rem] border-4 border-foreground/80 bg-background p-2">
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
                    {thumbnailUrl ? (
                      // biome-ignore lint/performance/noImgElement: signed media URL, no Next image loader.
                      <img
                        src={thumbnailUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : null}
                    {draft.thumbnail_text ? (
                      <span className="absolute inset-x-2 bottom-2 line-clamp-2 text-lg font-black uppercase leading-tight text-white [text-shadow:0_2px_6px_rgb(0_0_0/0.8)]">
                        {draft.thumbnail_text}
                      </span>
                    ) : null}
                  </div>
                  <p
                    className="mt-2 line-clamp-2 text-sm font-medium"
                    title={draft.title}
                  >
                    {draft.title.length > MOBILE_TITLE_CHARS
                      ? `${draft.title.slice(0, MOBILE_TITLE_CHARS - 1)}…`
                      : draft.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{songTitle}</p>
                </div>
              </figure>
            </CardContent>
          </Card>
        </>
      ) : null}

      {legacy.length ? (
        <section
          aria-labelledby="pub-legacy"
          data-testid="legacy-schedules"
          className="grid gap-1 text-sm"
        >
          <h2 id="pub-legacy" className="text-lg font-medium">
            {pt(lang, "legacyTitle")}
          </h2>
          <ul className="grid gap-1">
            {legacy.map((row) => (
              <li
                key={row.publication_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1"
              >
                <span>
                  {pt(lang, "legacyRow", {
                    video: row.video_id ?? "-",
                    at: row.publish_at ? romeTime(row.publish_at, lang) : "-",
                  })}
                </span>
                <ConfirmDialog
                  trigger={pt(lang, "legacyVeto")}
                  title={pt(lang, "legacyVeto")}
                  onConfirm={async () => {
                    const result = await vetoLegacyPublication({
                      publication_id: row.publication_id,
                    });
                    if (result.ok) refresh(pt(lang, "legacyVetoDone"))();
                    return result;
                  }}
                >
                  {pt(lang, "legacyVetoConfirm")}
                </ConfirmDialog>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">{pt(lang, "legacyHint")}</p>
        </section>
      ) : null}

      {current?.events.length ? (
        <section aria-labelledby="pub-history">
          <h2 id="pub-history" className="mb-3 text-lg font-medium">
            {pt(lang, "history")}
          </h2>
          <ol className="grid gap-1 text-sm">
            {[...current.events].reverse().map((event) => (
              <li
                key={`${event.at}-${event.kind}`}
                className="flex flex-wrap gap-x-3"
              >
                <time
                  className="text-muted-foreground tabular-nums"
                  dateTime={event.at}
                >
                  {romeTime(event.at, lang)}
                </time>
                <span>{pt(lang, `event.${event.kind}`)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {past.length ? (
        <section aria-label={pt(lang, "history")}>
          <ul className="grid gap-1 text-sm text-muted-foreground">
            {past.map((plan) => (
              <li key={plan.schedule_id}>
                {romeTime(plan.created_at, lang)} ·{" "}
                {pt(lang, `state.${plan.state}`)}
                {plan.destinations[0]?.external_url ? (
                  <>
                    {" · "}
                    <a
                      className="underline"
                      href={plan.destinations[0].external_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {pt(lang, "link")}
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
