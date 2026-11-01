"use client";

import {
  backgroundAsset,
  type Picture,
  type VisualizerParams,
} from "@mellodifai/shared";
import { useEffect, useState } from "react";

// Pictures the preview draws, loaded once per link. Links go through /media, which redirects to
// a fresh signed storage link; crossOrigin keeps the canvas readable.
const cache = new Map<string, Promise<Picture | null>>();

export function loadPicture(url: string): Promise<Picture | null> {
  const known = cache.get(url);
  if (known) return known;
  const pending = new Promise<Picture | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () =>
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    img.onerror = () => {
      cache.delete(url);
      resolve(null);
    };
    img.src = url;
  });
  cache.set(url, pending);
  return pending;
}

export function usePicture(url: string | null): Picture | null {
  const [state, setState] = useState<{
    url: string | null;
    pic: Picture | null;
  }>({
    url: null,
    pic: null,
  });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    void loadPicture(url).then((pic) => {
      if (alive) setState({ url, pic });
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return url && state.url === url ? state.pic : null;
}

export const TRUMPET_URL = "/brand/mellodifai-trumpet.png";
export const GRAMOPHONE_URL = "/brand/mellodifai-logo.png";

// What each slot of the frame shows, as links: the same choices the worker makes
// (apps/worker/src/stages/visualizer.ts), so the preview and the video agree.
export function pictureLinks(
  params: VisualizerParams,
  coverUrl: string | null,
): {
  background: string | null;
  backgroundVideo: string | null;
  center: string | null;
  marks: boolean;
} {
  const bg = params.background;
  const uploaded = backgroundAsset(params);
  return {
    background:
      bg.mode === "random"
        ? uploaded
        : bg.mode === "image"
          ? (uploaded ?? coverUrl)
          : uploaded
            ? null
            : coverUrl,
    backgroundVideo: bg.mode === "video" ? uploaded : null,
    center:
      params.centerImage.mode === "cover"
        ? coverUrl
        : params.centerImage.mode === "upload"
          ? (params.centerImage.assetUrl ?? coverUrl)
          : null,
    marks: params.preset === "classico",
  };
}
