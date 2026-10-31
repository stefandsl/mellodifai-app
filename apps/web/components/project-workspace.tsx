"use client";

import type { LyricPack } from "@mellodifai/shared";
import { useState } from "react";

import {
  approveLyrics,
  approveVideo,
  generateAgain,
  pickTake,
  rerenderVideo,
  setPrivacy,
  uploadPrivate,
} from "@/app/actions/checkpoints";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LyricEditor } from "./lyric-editor";
import { PublishConfirmDialog } from "./publish-confirm-dialog";
import { type Take, TakePicker } from "./take-picker";

type Render = {
  id: string;
  kind: string;
  previewUrl: string | null;
  qa_results: Record<string, boolean>;
};
export function ProjectWorkspace({
  version,
  takes,
  renders,
  publication,
}: {
  version: { id: string; status: string; lyric_pack: LyricPack | null };
  takes: Take[];
  renders: Render[];
  publication: {
    id: string;
    youtube_video_id: string | null;
    privacy: "public" | "unlisted" | "scheduled" | "private";
  } | null;
}) {
  const [overrideReason, setOverrideReason] = useState("");
  const master = renders.find((render) => render.kind === "master");
  const hook = renders.find((render) => render.kind === "hook");
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
        onGenerateAgain={() => generateAgain({ versionId: version.id })}
      />
    );
  if (version.status === "video_review")
    return (
      <section className="space-y-4">
        {master?.previewUrl && (
          // biome-ignore lint/a11y/useMediaCaption: captions are included in the upload stage.
          <video
            controls
            className="w-full rounded-xl"
            src={master.previewUrl}
          />
        )}
        {hook?.previewUrl && (
          // biome-ignore lint/a11y/useMediaCaption: captions are included in the upload stage.
          <video controls className="w-full rounded-xl" src={hook.previewUrl} />
        )}
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(master?.qa_results ?? {}).map(([name, passed]) => (
              <tr key={name}>
                <td className="border-b py-2">{name}</td>
                <td className="border-b py-2">{passed ? "Pass" : "Fail"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button onClick={() => approveVideo({ versionId: version.id })}>
          Approva video
        </Button>
        <div className="flex gap-2">
          <Input
            aria-label="Override reason"
            placeholder="Motivo override"
            value={overrideReason}
            onChange={(event) => setOverrideReason(event.target.value)}
          />
          <Button
            variant="outline"
            disabled={overrideReason.trim().length < 3}
            onClick={() =>
              rerenderVideo({ versionId: version.id, overrideReason })
            }
          >
            Rigenera video
          </Button>
        </div>
      </section>
    );
  if (version.status === "approved" || version.status === "publishing")
    return <PublishPanel renderId={master?.id} publication={publication} />;
  return (
    <p className="text-muted-foreground">
      Il prossimo passaggio verra' mostrato qui.
    </p>
  );
}

function PublishPanel({
  renderId,
  publication,
}: {
  renderId?: string;
  publication: {
    id: string;
    youtube_video_id: string | null;
    privacy: "public" | "unlisted" | "scheduled" | "private";
  } | null;
}) {
  const [publishAt, setPublishAt] = useState("");
  if (publication?.youtube_video_id)
    return (
      <section className="space-y-3">
        <p>Video: {publication.youtube_video_id}</p>
        <label
          className="block text-sm"
          htmlFor={`publish-at-${publication.id}`}
        >
          Data e ora di pubblicazione
          <Input
            id={`publish-at-${publication.id}`}
            type="datetime-local"
            value={publishAt}
            onChange={(event) => setPublishAt(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {(["public", "unlisted", "scheduled"] as const).map((privacy) => (
            <PublishConfirmDialog
              key={privacy}
              videoName={publication.youtube_video_id ?? "video"}
              privacy={privacy}
              onConfirm={() =>
                setPrivacy({
                  publicationId: publication.id,
                  privacy,
                  ...(privacy === "scheduled" && publishAt
                    ? { publishAt: new Date(publishAt).toISOString() }
                    : {}),
                })
              }
            />
          ))}
        </div>
      </section>
    );
  return (
    <form
      className="space-y-3"
      action={async (data) => {
        if (renderId)
          await uploadPrivate({
            renderId,
            metadata: {
              title: String(data.get("title")),
              description: String(data.get("description")),
              tags: String(data.get("tags")),
              chapters: String(data.get("chapters")),
            },
          });
      }}
    >
      <Input name="title" placeholder="Titolo video" required />
      <Textarea name="description" placeholder="Descrizione" />
      <Input name="tags" placeholder="Tag" />
      <Textarea name="chapters" placeholder="Capitoli" />
      <Button>Carica come privato</Button>
    </form>
  );
}
