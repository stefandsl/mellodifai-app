"use client";

import {
  backgroundAsset,
  type Picture,
  type VisualizerParams,
  withFocus,
} from "@mellodifai/shared";
import { useEffect, useState } from "react";

// Pictures the preview draws, loaded once per link. Links go through /media, which redirects to
// a fresh signed storage link; crossOrigin keeps the canvas readable.
const cache = new Map<string, Promise<Picture | null>>();

// `subject`: also read where the subject sits, for the square crop of the centre picture
// (shared withFocus; the render does the same).
export function loadPicture(
  url: string,
  subject = false,
): Promise<Picture | null> {
  const key = subject ? `subject:${url}` : url;
  const known = cache.get(key);
  if (known) return known;
  const pending = new Promise<Picture | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      const pic: Picture = {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
      resolve(subject ? withFocus(pic, scratchCanvas) : pic);
    };
    img.onerror = () => {
      cache.delete(key);
      resolve(null);
    };
    img.src = url;
  });
  cache.set(key, pending);
  return pending;
}

function scratchCanvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

export function usePicture(
  url: string | null,
  subject = false,
): Picture | null {
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
    void loadPicture(url, subject).then((pic) => {
      if (alive) setState({ url, pic });
    });
    return () => {
      alive = false;
    };
  }, [url, subject]);
  return url && state.url === url ? state.pic : null;
}

// What each slot of the frame shows, as links: the same choices the worker makes
// (apps/worker/src/stages/visualizer.ts), so the preview and the video agree.
export function pictureLinks(
  params: VisualizerParams,
  coverUrl: string | null,
): {
  background: string | null;
  backgroundVideo: string | null;
  center: string | null;
  // The user's logos, in the order of params.logos.
  logos: string[];
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
    logos: params.logos.map((logo) => logo.assetUrl),
  };
}
