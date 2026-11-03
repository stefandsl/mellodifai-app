"use client";

import { useEffect, useRef, useState } from "react";

export function CrossfadeCover({ art }: { art: string }) {
  const [shown, setShown] = useState(art);
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const last = useRef(art);

  useEffect(() => {
    if (last.current === art) return;
    setOutgoing(last.current);
    last.current = art;
    setShown(art);
    const timer = window.setTimeout(() => setOutgoing(null), 400);
    return () => window.clearTimeout(timer);
  }, [art]);

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
