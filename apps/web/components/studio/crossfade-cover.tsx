"use client";

import { useEffect, useRef, useState } from "react";

export function CrossfadeCover({
  art,
  coverUrl,
}: {
  art: string;
  coverUrl?: string | null;
}) {
  const [shown, setShown] = useState(art);
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const last = useRef(art);

  useEffect(() => {
    if (last.current === art) return;
    let cancelled = false;
    let timer: number | undefined;
    const show = () => {
      if (cancelled) return;
      setOutgoing(last.current);
      last.current = art;
      setShown(art);
      timer = window.setTimeout(() => setOutgoing(null), 400);
    };
    if (coverUrl && document.documentElement.classList.contains("glass")) {
      const image = new Image();
      image.onload = () => void image.decode().then(show, show);
      image.onerror = show;
      image.src = coverUrl;
    } else {
      show();
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [art, coverUrl]);

  return (
    <span
      aria-hidden
      className="absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      {outgoing && (
        <span className="absolute inset-0" style={{ background: outgoing }} />
      )}
      <span
        key={shown}
        className="cover-enter absolute inset-0"
        style={{ background: shown }}
      />
    </span>
  );
}
