"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

import { requestVisualizer } from "@/app/actions/visualizer";
import { useLocale } from "@/components/locale-provider";
import { mediaUrl } from "@/lib/media";
import { downloadName } from "@/lib/studio/clips";
import { st, stf } from "@/lib/studio/i18n";
import { createClient } from "@/lib/supabase/browser";
import { useVideoStudio, type WatchedRender } from "@/store/video-studio";

const POLL_MS = 3000;

type JobRow = {
  id: string;
  status: string;
  error: string | null;
  started_at: string | null;
  render_id: string | null;
};

// Queues the same look again ("Riprova") and keeps watching the new job.
export async function startRender(
  lang: "it" | "en",
  render: Omit<WatchedRender, "jobId">,
  refresh?: () => void,
): Promise<string | null> {
  const result = await requestVisualizer({
    versionId: render.clipId,
    params: render.params,
  });
  if (!result.ok || !result.id) {
    toast.error(st(lang, "vs.requestFailed"), {
      description: result.ok ? undefined : result.error,
    });
    return null;
  }
  useVideoStudio
    .getState()
    .watch({ ...render, jobId: result.id, status: "queued" });
  refresh?.();
  return result.id;
}

// Follows the renders started in this browser, wherever the owner goes: progress for the studio
// footer, then a toast with "Scarica" when the video is ready or with the reason and "Riprova"
// when it failed. The studio does not have to stay open.
export function VisualizerWatcher() {
  const lang = useLocale();
  const router = useRouter();
  const count = useVideoStudio((s) => s.watched.length);
  useEffect(() => {
    void useVideoStudio.persist.rehydrate();
  }, []);
  useEffect(() => {
    if (count === 0) return;
    const supabase = createClient();
    let alive = true;
    const poll = async () => {
      const watched = useVideoStudio.getState().watched;
      if (!watched.length) return;
      const { data } = await supabase
        .from("jobs")
        .select("id,status,error,started_at,render_id:payload->>render_id")
        .in(
          "id",
          watched.map((item) => item.jobId),
        );
      if (!alive || !data) return;
      const rows = data as JobRow[];
      const queue = rows.some((row) => row.status === "queued")
        ? (((await supabase.rpc("my_visualizer_queue")).data ?? []) as {
            version_id: string;
            aspect: string;
            queue_position: number;
          }[])
        : [];
      for (const item of watched) {
        const row = rows.find((r) => r.id === item.jobId);
        if (!row) {
          // The song went away (trash, deleted): nothing left to report.
          useVideoStudio.getState().unwatch(item.jobId);
          continue;
        }
        if (row.status === "queued" || row.status === "running") {
          let pct: number | null = null;
          if (row.status === "running") {
            const { data: events } = await supabase
              .from("job_events")
              .select("progress,at")
              .eq("job_id", row.id)
              .not("progress", "is", null)
              .order("id", { ascending: false })
              .limit(1);
            const latest = (events ?? [])[0] as
              | { progress: number; at: string }
              | undefined;
            pct =
              latest &&
              row.started_at &&
              Date.parse(latest.at) >= Date.parse(row.started_at)
                ? latest.progress
                : 0;
          }
          useVideoStudio.getState().report(row.id, {
            status: row.status,
            pct,
            queue:
              queue.find(
                (q) => q.version_id === item.clipId && q.aspect === item.aspect,
              )?.queue_position ?? null,
          });
          continue;
        }
        useVideoStudio.getState().unwatch(item.jobId);
        router.refresh();
        if (row.status === "done") {
          const { data: render } = await supabase
            .from("renders")
            .select("preview_path")
            .eq("id", row.render_id ?? "")
            .maybeSingle();
          const path = (render as { preview_path?: string | null } | null)
            ?.preview_path;
          toast.success(stf(lang, "vs.done", { title: item.title }), {
            id: `visualizer-${item.jobId}`,
            duration: 15000,
            ...(path
              ? {
                  description: item.aspect,
                  action: {
                    label: st(lang, "vs.download"),
                    onClick: () => {
                      const name = downloadName(
                        item.title,
                        `visualizer ${item.aspect.replace(":", "x")}.mp4`,
                      );
                      window.location.assign(
                        `${mediaUrl(path)}?download=${encodeURIComponent(name)}`,
                      );
                    },
                  },
                }
              : {}),
          });
        } else {
          toast.error(stf(lang, "vs.failed", { title: item.title }), {
            id: `visualizer-${item.jobId}`,
            duration: 20000,
            description: row.error ?? undefined,
            action: {
              label: st(lang, "vs.retry"),
              onClick: () => {
                const {
                  jobId: _old,
                  status: _s,
                  pct: _p,
                  queue: _q,
                  ...again
                } = item;
                void startRender(lang, again, router.refresh);
              },
            },
          });
        }
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [count, lang, router]);
  return null;
}
