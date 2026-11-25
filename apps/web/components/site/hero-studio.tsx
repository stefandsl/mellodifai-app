"use client";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { VStack } from "@astryxdesign/core/VStack";
import { useEffect, useRef, useState } from "react";
import type { SiteCopy } from "@/lib/site/copy";
import { HERO_SAMPLE, type SampleWord } from "@/lib/site/sample";
import { SiteIcon, SiteText } from "@/src/site-primitives";
import { Wave } from "./art";
import { PauseGlyph, PlayGlyph } from "./icons";

type State = "idle" | "playing" | "missing";

// The first screen's proof: one real lyric line whose last word the visitor picks, and a play
// button that plays that take (pre-rendered clips of our own song, lib/site/sample.ts).
export function HeroStudio({ copy }: { copy: SiteCopy["hero"] }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [word, setWord] = useState<SampleWord>(HERO_SAMPLE.first);
  const [state, setState] = useState<State>("idle");
  const edited = word !== HERO_SAMPLE.first;

  // Say at once when the clips are not online, instead of after a press of play.
  useEffect(() => {
    let live = true;
    fetch(HERO_SAMPLE.clips[HERO_SAMPLE.first], { method: "HEAD" })
      .then((r) => {
        if (live && !r.ok) setState("missing");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const onEnd = () => setState((s) => (s === "playing" ? "idle" : s));
    const onError = () => setState("missing");
    a.addEventListener("ended", onEnd);
    a.addEventListener("error", onError);
    return () => {
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("error", onError);
    };
  }, []);

  const pick = (next: SampleWord) => {
    if (next === word) return;
    setWord(next);
    const a = audio.current;
    if (a && state === "playing") {
      a.pause();
      setState("idle");
    }
  };

  const toggle = async () => {
    const a = audio.current;
    if (!a) return;
    if (state === "playing") {
      a.pause();
      setState("idle");
      return;
    }
    const src = HERO_SAMPLE.clips[word];
    if (!a.src.endsWith(src)) a.src = src;
    try {
      await a.play();
      setState("playing");
    } catch {
      setState("missing");
    }
  };

  const status =
    state === "missing"
      ? copy.missing
      : state === "playing"
        ? `${copy.nowPlaying}: ${copy.lineStart} ${word}`
        : copy.ready;

  const studioConfig = JSON.stringify({
    first: HERO_SAMPLE.first,
    clips: HERO_SAMPLE.clips,
    play: copy.play,
    pause: copy.pause,
    ready: copy.ready,
    missing: copy.missing,
    nowPlaying: copy.nowPlaying,
    lineStart: copy.lineStart,
  });

  return (
    <VStack
      as="figure"
      className="site-studio"
      aria-labelledby="hero-studio-label"
      data-word={word}
      data-hero-studio={studioConfig}
    >
      <HStack className="site-studio__bar" gap={3} align="center" wrap="wrap">
        <SiteText type="code" className="site-tag">
          {copy.take}
        </SiteText>
        <SiteText className="site-studio__song">{copy.song}</SiteText>
        <SiteText
          type="code"
          color="secondary"
          className="site-studio__meta site-eyebrow"
        >
          {copy.key}
        </SiteText>
        <SiteText
          type="code"
          color="secondary"
          className="site-studio__meta site-eyebrow"
        >
          {copy.tempo}
        </SiteText>
      </HStack>

      <VStack className="site-studio__body" gap={4}>
        <VStack className="site-studio__line" gap={1}>
          <SiteText type="code" color="secondary" className="site-eyebrow">
            {copy.lineLabel}
          </SiteText>
          <SiteText as="p" className="site-studio__lyric">
            <q lang="en" className="site-studio__quote">
              {copy.lineStart}{" "}
              <SiteText
                className={`site-studio__word ${edited ? "is-edited" : ""}`}
                color="inherit"
              >
                {edited ? (
                  <del className="site-studio__old">{HERO_SAMPLE.first}</del>
                ) : null}
                <ins className="site-studio__new">{word}</ins>
              </SiteText>
              {copy.lineEnd}
            </q>
          </SiteText>
        </VStack>
        <HStack
          className="site-studio__controls"
          gap={3}
          align="center"
          wrap="wrap"
        >
          <HStack
            role="group"
            aria-label={copy.wordLabel}
            gap={2}
            wrap="wrap"
            className="site-studio__words"
          >
            {copy.words.map((w) => (
              <ToggleButton
                key={w.word}
                label={`${w.word}, ${w.take}`}
                isPressed={w.word === word}
                onPressedChange={() => pick(w.word as SampleWord)}
                className="site-chip"
              >
                <SiteText color="inherit" className="site-chip__word">
                  {w.word}
                </SiteText>{" "}
                <SiteText
                  type="supporting"
                  color="inherit"
                  className="site-chip__take"
                >
                  {w.take}
                </SiteText>
              </ToggleButton>
            ))}
          </HStack>
          <Button
            label={state === "playing" ? copy.pause : copy.play}
            variant="primary"
            size="lg"
            icon={
              <SiteIcon
                icon={state === "playing" ? PauseGlyph : PlayGlyph}
                size="sm"
                color="inherit"
              />
            }
            onClick={toggle}
            isDisabled={state === "missing"}
            className="site-studio__play"
            data-state={state}
          />
        </HStack>
        <SiteText
          as="p"
          id="hero-studio-label"
          type="supporting"
          color="secondary"
          className="site-studio__hint"
        >
          {copy.studioLabel}
        </SiteText>
        <VStack className="site-studio__lanes" aria-hidden="true">
          {copy.lanes.map((lane, i) => (
            <HStack
              key={lane}
              className="site-studio__lane"
              align="center"
              gap={3}
            >
              <SiteText
                type="code"
                color="secondary"
                className="site-studio__lane-name site-eyebrow"
              >
                {lane}
              </SiteText>
              <Wave
                seed={11 + i * 7}
                phrases={i === 2 ? 0 : 3}
                className={i === 2 ? "site-wave--band" : ""}
                take={i < 2 && edited ? [0.62, 0.79] : undefined}
              />
            </HStack>
          ))}
        </VStack>
      </VStack>
      <HStack
        as="figcaption"
        className="site-studio__foot"
        gap={3}
        align="center"
      >
        <HStack
          as="span"
          className={`site-dot ${state === "missing" ? "site-dot--muted" : "site-dot--live"}`}
          aria-hidden="true"
        />
        <SiteText type="supporting" role="status" aria-live="polite">
          {status}
        </SiteText>
      </HStack>
      {/* biome-ignore lint/a11y/useMediaCaption: the clip is one sung line whose words are on screen above it. */}
      <audio ref={audio} preload="none" className="site-studio__audio" />
    </VStack>
  );
}
