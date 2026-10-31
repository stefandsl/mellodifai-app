"use client";
import { type LyricPack, t, type VersionStatus } from "@mellodifai/shared";
import { useState } from "react";
import {
  approveLyrics,
  approveVideo,
  backToLyrics,
  generateAgain,
  pickTake,
  rerenderVideo,
  resolveKieSubmission,
  resolveUpload,
  retryStage,
  setPrivacy,
  uploadPrivate,
} from "@/app/actions/checkpoints";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { publicationDefaults } from "@/lib/publication-defaults";
import { ConfirmDialog } from "./confirm-dialog";
import { useLocale } from "./locale-provider";
import { LyricEditor } from "./lyric-editor";
import { PublishConfirmDialog } from "./publish-confirm-dialog";
import { SubmissionResolution } from "./submission-resolution";
import { type Take, TakePicker } from "./take-picker";
import { useAction } from "./use-action";
export type RenderPreview = {
  id: string;
  kind: string;
  previewUrl: string | null;
  qa_results: { gates?: { name: string; pass: boolean; value: unknown }[] };
};
export type PublicationView = {
  upload_state?: string;
  id: string;
  youtube_video_id: string | null;
  privacy: "public" | "unlisted" | "scheduled" | "private";
  metadata?: { title?: string };
};
export type WorkspaceVersion = {
  id: string;
  lang: string;
  status: VersionStatus;
  lyric_pack: LyricPack | null;
  generation_count: number;
  render_attempt: number;
  storyboard_sections?: unknown;
  kie_submit_state?: string | null;
  kie_task_id?: string | null;
  kie_task_state?: string | null;
};
export function ProjectWorkspace({
  version,
  takes,
  renders,
  publication,
  brief = "",
  failedJob,
  thumbnailUrl,
  activeJob = false,
  isAdmin = false,
  quotaNotBefore,
}: {
  version: WorkspaceVersion;
  takes: Take[];
  renders: RenderPreview[];
  publication: PublicationView | null;
  brief?: string;
  failedJob?: { id: string; error: string | null; stage?: string };
  activeJob?: boolean;
  isAdmin?: boolean;
  quotaNotBefore?: string | null;
  thumbnailUrl?: string | null;
}) {
  const lang = useLocale();
  const { pending, run } = useAction();
  const [reason, setReason] = useState("");
  const master = renders.find((r) => r.kind === "master");
  const gates = master?.qa_results.gates ?? [];
  const failed = gates.some((g) => !g.pass);
  const freeKieRetry =
    Boolean(version.kie_task_id) && version.kie_task_state !== "failed";
  const defaults = publicationDefaults(
    version.lyric_pack?.title ?? "",
    brief,
    version.lang,
    version.storyboard_sections,
    lang,
  );
  if (version.status === "lyrics_review" && version.lyric_pack)
    return (
      <LyricEditor
        pack={version.lyric_pack}
        theme="vbp"
        onApprove={(pack) => approveLyrics({ versionId: version.id, pack })}
      />
    );
  if (version.status === "takes_review")
    return (
      <TakePicker
        takes={takes}
        onPick={(takeId) => pickTake({ versionId: version.id, takeId })}
        onGenerateAgain={() =>
          generateAgain({
            versionId: version.id,
            generation: version.generation_count,
          })
        }
      />
    );
  if (version.status === "video_review")
    return (
      <section className="space-y-4">
        {renders.map(
          (r) =>
            r.previewUrl && (
              // biome-ignore lint/a11y/useMediaCaption: lyric video contains the reviewed lyrics.
              <video
                key={r.id}
                controls
                className="w-full rounded-xl"
                src={r.previewUrl}
              />
            ),
        )}
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th>{t(lang, "qa.gate")}</th>
              <th>{t(lang, "qa.value")}</th>
              <th>{t(lang, "pipeline.title")}</th>
            </tr>
          </thead>
          <tbody>
            {gates.map((g) => (
              <tr key={g.name}>
                <td>
                  {[
                    "integrated_loudness",
                    "true_peak",
                    "crushed_words",
                    "duration",
                  ].includes(g.name)
                    ? t(lang, `qa.${g.name}` as "qa.duration")
                    : g.name}
                </td>
                <td>
                  {typeof g.value === "object"
                    ? JSON.stringify(g.value)
                    : g.value === "not measured"
                      ? t(lang, "qa.notMeasured")
                      : String(g.value ?? "")}
                </td>
                <td>{t(lang, g.pass ? "qa.pass" : "qa.fail")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {failed && (
          <label htmlFor="override-reason">
            {t(lang, "qa.override")}
            <Input
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              pending || !gates.length || (failed && reason.trim().length < 3)
            }
            onClick={() =>
              run(() =>
                approveVideo({ versionId: version.id, overrideReason: reason }),
              )
            }
          >
            {t(lang, "action.approveVideo")}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => run(() => rerenderVideo({ versionId: version.id }))}
          >
            {t(lang, "action.rerender")}
          </Button>
        </div>
      </section>
    );
  if (version.status === "failed")
    return (
      <section className="space-y-4">
        <h2>{t(lang, "status.failed")}</h2>
        <p role="alert">{failedJob?.error}</p>
        {failedJob?.stage === "publish" ? (
          <PublishPanel
            renderId={master?.id}
            defaults={defaults}
            publication={publication}
            uploading={activeJob}
            quotaNotBefore={quotaNotBefore}
            isAdmin={isAdmin}
            retry={
              !activeJob && publication?.upload_state !== "uploading"
                ? () =>
                    retryStage({ versionId: version.id, jobId: failedJob.id })
                : undefined
            }
          />
        ) : version.kie_submit_state === "submitting" &&
          !version.kie_task_id ? (
          isAdmin && !activeJob ? (
            <SubmissionResolution
              kind="kie"
              resolve={(charged, taskId) =>
                resolveKieSubmission({
                  versionId: version.id,
                  charged,
                  ...(taskId ? { taskId } : {}),
                })
              }
            />
          ) : null
        ) : (
          <>
            {failedJob?.stage === "generate_song" && (
              <>
                {!freeKieRetry && (
                  <ConfirmDialog
                    disabled={pending}
                    trigger={t(lang, "action.generateAgain")}
                    title={t(lang, "dialog.generation")}
                    onConfirm={() =>
                      run(() =>
                        generateAgain({
                          versionId: version.id,
                          generation: version.generation_count,
                        }),
                      )
                    }
                  >
                    {t(lang, "dialog.cost")}
                  </ConfirmDialog>
                )}
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(() => backToLyrics({ versionId: version.id }))
                  }
                >
                  {t(lang, "action.backToLyrics")}
                </Button>
              </>
            )}
            {(failedJob?.stage !== "generate_song" || freeKieRetry) && (
              <Button
                disabled={pending || !failedJob}
                onClick={() =>
                  failedJob &&
                  run(() =>
                    retryStage({ versionId: version.id, jobId: failedJob.id }),
                  )
                }
              >
                {t(
                  lang,
                  failedJob?.stage === "generate_song"
                    ? "action.retryKieFree"
                    : "action.retry",
                )}
              </Button>
            )}
          </>
        )}
      </section>
    );
  if (version.status === "song_queued") return <p>{t(lang, "panel.queued")}</p>;
  if (["approved", "publishing", "published"].includes(version.status))
    return (
      <>
        <section className="mb-8 space-y-6">
          {(["master", "hook"] as const).map((kind) => {
            const preview = renders.find(
              (render) => render.kind === kind,
            )?.previewUrl;
            return (
              <figure key={kind} className="space-y-2">
                <figcaption className="text-sm font-medium">
                  {t(lang, `media.${kind}`)}
                </figcaption>
                {preview ? (
                  // biome-ignore lint/a11y/useMediaCaption: reviewed lyric video has embedded lyrics.
                  <video
                    controls
                    preload="metadata"
                    aria-label={t(lang, `media.${kind}`)}
                    src={preview}
                    className={
                      kind === "master"
                        ? "aspect-video w-full rounded-lg bg-black"
                        : "max-h-96 w-full rounded-lg bg-black"
                    }
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t(lang, "media.unavailable")}
                  </p>
                )}
              </figure>
            );
          })}
          {thumbnailUrl && (
            <figure className="space-y-2">
              <figcaption className="text-sm font-medium">
                {t(lang, "media.thumbnail")}
              </figcaption>
              {/* The private signed URL must not go through a shared image optimizer cache. */}
              {/* biome-ignore lint/performance/noImgElement: private one-hour signed preview. */}
              <img
                src={thumbnailUrl}
                alt={t(lang, "media.thumbnail")}
                width={1280}
                height={720}
                loading="lazy"
                className="aspect-video w-full rounded-lg object-contain"
              />
            </figure>
          )}
        </section>
        <PublishPanel
          renderId={master?.id}
          defaults={defaults}
          publication={publication}
          uploading={activeJob}
          quotaNotBefore={quotaNotBefore}
          isAdmin={isAdmin}
        />
      </>
    );
  return <p className="text-muted-foreground">{t(lang, "panel.wait")}</p>;
}
export function PublishPanel({
  renderId,
  defaults,
  publication,
  uploading = false,
  isAdmin = false,
  retry,
  quotaNotBefore,
}: {
  renderId?: string;
  defaults: ReturnType<typeof publicationDefaults>;
  publication: PublicationView | null;
  uploading?: boolean;
  quotaNotBefore?: string | null;
  isAdmin?: boolean;
  retry?:
    | (() => Promise<import("@/lib/action-result").ActionResult>)
    | undefined;
}) {
  const lang = useLocale();
  const { pending, run } = useAction();
  const [publishAt, setPublishAt] = useState("");
  if (quotaNotBefore && Date.parse(quotaNotBefore) > Date.now())
    return (
      <p suppressHydrationWarning>
        {t(lang, "publish.quotaWait").replace(
          "{time}",
          new Date(quotaNotBefore).toLocaleString(lang),
        )}
      </p>
    );
  if (uploading) return <p>{t(lang, "publish.wait")}</p>;
  if (publication?.upload_state === "uploading")
    return isAdmin ? (
      <SubmissionResolution
        kind="upload"
        resolve={(uploaded, videoId) =>
          resolveUpload({
            publicationId: publication.id,
            uploaded,
            ...(videoId ? { videoId } : {}),
          })
        }
      />
    ) : (
      <p>{t(lang, "publish.wait")}</p>
    );
  if (retry)
    return (
      <Button disabled={pending || !isAdmin} onClick={() => run(retry)}>
        {t(lang, "action.retry")}
      </Button>
    );
  if (publication?.youtube_video_id)
    return (
      <section className="space-y-4">
        <p>
          {t(lang, "publish.video")}:{" "}
          {publication.metadata?.title ?? defaults.title}
        </p>
        <p>
          {t(lang, "publish.privacy")}:{" "}
          {t(lang, `visibility.${publication.privacy}`)}
        </p>
        <a
          className="underline"
          href={`https://www.youtube.com/watch?v=${publication.youtube_video_id}`}
          target="_blank"
          rel="noreferrer"
        >
          {t(lang, "media.youtube")}
        </a>
        <label htmlFor="publish-at">
          {t(lang, "publish.at")}
          <Input
            id="publish-at"
            type="datetime-local"
            value={publishAt}
            onChange={(e) => setPublishAt(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {(["public", "unlisted", "scheduled", "private"] as const).map(
            (privacy) => (
              <PublishConfirmDialog
                key={privacy}
                videoName={publication.metadata?.title ?? defaults.title}
                privacy={privacy}
                disabled={
                  privacy === "scheduled" &&
                  (!publishAt || Date.parse(publishAt) <= Date.now())
                }
                onConfirm={() =>
                  setPrivacy({
                    publicationId: publication.id,
                    privacy,
                    ...(privacy === "scheduled"
                      ? { publishAt: new Date(publishAt).toISOString() }
                      : {}),
                  })
                }
              />
            ),
          )}
        </div>
      </section>
    );
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        if (renderId)
          run(() =>
            uploadPrivate({
              renderId,
              metadata: Object.fromEntries(
                ["title", "description", "tags", "chapters"].map((k) => [
                  k,
                  String(data.get(k)),
                ]),
              ),
            }),
          );
      }}
    >
      {(["title", "description", "tags", "chapters"] as const).map((field) => (
        <label className="grid gap-2" key={field} htmlFor={`publish-${field}`}>
          {t(lang, `publish.${field}`)}
          {field === "title" || field === "tags" ? (
            <Input
              id={`publish-${field}`}
              name={field}
              defaultValue={defaults[field]}
              required={field === "title"}
            />
          ) : (
            <Textarea
              id={`publish-${field}`}
              name={field}
              defaultValue={defaults[field]}
            />
          )}
        </label>
      ))}
      <Button type="submit" disabled={pending || !renderId}>
        {t(lang, "action.uploadPrivate")}
      </Button>
    </form>
  );
}
