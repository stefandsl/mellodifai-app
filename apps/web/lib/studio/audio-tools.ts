import { toast } from "sonner";

import { requestStems } from "@/app/actions/audio-tools";
import type { Clip } from "./clips";
import { st } from "./i18n";
import { stemsHref } from "./stems";

// "Estrai stems" from a menu or the details panel: asks the render PC for the stems unless they
// exist or are on their way (a failed request is asked again), then opens the stems page,
// which shows the result or the progress.
export async function openStems(
  clip: Clip,
  lang: "it" | "en",
  navigate: (href: string) => void,
): Promise<void> {
  const status = clip.stems?.status;
  if (status !== "done" && status !== "queued" && status !== "running") {
    const result = await requestStems({ versionId: clip.id });
    if (!result.ok) toast.error(st(lang, "tool.stemsFailed"));
  }
  navigate(stemsHref(clip.id));
}
