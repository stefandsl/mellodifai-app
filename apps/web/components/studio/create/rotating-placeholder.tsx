"use client";

import { useEffect, useState } from "react";

// Cycles example text every 4 s with a fade while the field is empty (brief section 2.2).
export function RotatingPlaceholder({
  examples,
  visible,
  className,
}: {
  examples: readonly string[];
  visible: boolean;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % examples.length),
      4000,
    );
    return () => clearInterval(timer);
  }, [visible, examples.length]);
  if (!visible) return null;
  return (
    <span
      aria-hidden
      key={index}
      className={`placeholder-cycle pointer-events-none absolute text-[var(--fg-subtle)] ${className ?? ""}`}
    >
      {examples[index]}
    </span>
  );
}

export const PROMPT_EXAMPLES = {
  it: [
    "Chillwave malinconica su uno specchio rotto",
    "Pop italiano anni 80 sul lunedi mattina in ufficio",
    "Ballata acustica su una partenza senza ritorno",
    "Rap ironico sulle riunioni che potevano essere una mail",
    "Indie rock estivo su un amore sbagliato",
  ],
  en: [
    "Melodic chillwave song about a broken mirror",
    "Grand 2-step song about walking away for good",
    "Light russian pop song about escapism",
    "Singer-songwriter song about hookups at parties",
    "Playful rap song about falling for the wrong person",
  ],
} as const;

export const STYLE_EXAMPLES = [
  "big room house, 808 beats, call and response, natural vocals, bass-house",
  "italo disco, analog synth, warm bass, female vocals, 118 bpm",
  "acoustic folk, fingerpicked guitar, soft harmonies, intimate",
  "lo-fi hip hop, dusty drums, jazzy chords, mellow",
] as const;
