import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import Image from "next/image";
import type { SiteCopy, SiteLang } from "@/lib/site/copy";
import {
  buildClipCaptionDataUri,
  CLIP_HERO_IMAGE_SIZES,
  CLIP_SPEEDS,
  formatClipTime,
} from "@/lib/site/recipe-detail-helpers";
import {
  SiteButton,
  SiteIcon,
  SiteIconButton,
  SiteText,
} from "@/src/site-primitives";
import { Wave } from "./art";
import { FullscreenGlyph, PlayGlyph, VolumeGlyph } from "./icons";

export type ClipPlayerProps = {
  slug: string;
  title: string;
  lyricLine: string;
  coverSrc: string;
  backdropSrc: string;
  mediaSrc: string;
  isVideo: boolean;
  estimatedSeconds: number;
  lang: SiteLang;
  copy: SiteCopy["recipeDetail"]["player"];
};

// Server-rendered clip player with custom accessible controls and ambient glow.
// Never autoplays, never emits sound before an explicit click, and preloads nothing until play.
// The vanilla island (lib/site/islands/recipe-detail.ts) wires play/pause, seek, speed,
// mute/volume, fullscreen, and keyboard controls after mount.
export function ClipPlayer({
  slug,
  title,
  lyricLine,
  coverSrc,
  backdropSrc,
  mediaSrc,
  isVideo,
  estimatedSeconds,
  lang,
  copy,
}: ClipPlayerProps) {
  const initialDurationLabel = formatClipTime(0);
  const captionUri = buildClipCaptionDataUri(title, lyricLine);
  const playerConfig = JSON.stringify({
    slug,
    isVideo,
    speeds: CLIP_SPEEDS,
    copy: {
      play: copy.play,
      pause: copy.pause,
      speed: copy.speed,
      mute: copy.mute,
      unmute: copy.unmute,
      fullscreen: copy.fullscreen,
      exitFullscreen: copy.exitFullscreen,
      readyStatus: copy.readyStatus,
      playingStatus: copy.playingStatus,
      pausedStatus: copy.pausedStatus,
      of: copy.of,
    },
  });

  return (
    <VStack
      className="site-clip-shell"
      data-clip-player={playerConfig}
      data-playing="false"
      data-muted="false"
      data-fullscreen="false"
      data-speed="1"
    >
      <VStack className="site-clip__glow" aria-hidden="true" />
      <VStack
        as="figure"
        className="site-clip"
        role="region"
        aria-label={copy.regionLabel}
      >
        <VStack className="site-clip__stage" data-clip-stage="true">
          <Image
            src={backdropSrc}
            alt=""
            fill
            unoptimized
            loading="lazy"
            aria-hidden="true"
            sizes={CLIP_HERO_IMAGE_SIZES}
            className="site-clip__backdrop"
          />
          <Image
            src={coverSrc}
            alt={title}
            fill
            unoptimized
            priority
            fetchPriority="high"
            sizes={CLIP_HERO_IMAGE_SIZES}
            className="site-clip__poster"
            data-clip-poster="true"
          />
          {isVideo ? (
            <video
              className="site-clip__media"
              src={mediaSrc}
              poster={backdropSrc}
              preload="none"
              playsInline
              data-clip-media="true"
            >
              <track
                kind="captions"
                srcLang={lang}
                label={title}
                src={captionUri}
              />
            </video>
          ) : (
            <>
              <VStack className="site-clip__audio-visual" aria-hidden="true">
                <Wave seed={17} phrases={3} className="site-clip__wave" />
              </VStack>
              {/* biome-ignore lint/a11y/useMediaCaption: audio preview displays the lyric highlight on screen. */}
              <audio
                className="site-clip__audio"
                src={mediaSrc}
                preload="none"
                data-clip-media="true"
              />
            </>
          )}
          <HStack
            as="figcaption"
            className="site-clip__caption"
            align="center"
            gap={2}
          >
            <HStack as="span" className="site-dot" aria-hidden="true" />
            <SiteText
              type="supporting"
              weight="medium"
              className="site-clip__lyric"
            >
              {lyricLine}
            </SiteText>
          </HStack>
        </VStack>

        <VStack className="site-clip__controls" gap={2}>
          <VStack
            role="slider"
            tabIndex={0}
            aria-label={copy.seek}
            aria-valuemin={0}
            aria-valuemax={estimatedSeconds}
            aria-valuenow={0}
            aria-valuetext={`${initialDurationLabel} ${copy.of} ${formatClipTime(estimatedSeconds)}`}
            className="site-clip__seek"
            data-clip-seek="true"
          >
            <VStack className="site-clip__seek-track" aria-hidden="true">
              <VStack
                className="site-clip__seek-fill"
                data-clip-seek-fill="true"
              />
            </VStack>
          </VStack>

          <HStack
            className="site-clip__bar"
            align="center"
            justify="between"
            gap={3}
            wrap="wrap"
          >
            <HStack align="center" gap={2} className="site-clip__left">
              <SiteIconButton
                label={copy.play}
                icon={<SiteIcon icon={PlayGlyph} size="sm" color="inherit" />}
                variant="secondary"
                size="sm"
                className="site-clip__play site-button--inverted"
                data-clip-play="true"
              />
              <SiteText
                type="code"
                color="secondary"
                className="site-clip__time"
                data-clip-time="true"
              >
                {`${initialDurationLabel} / ${formatClipTime(estimatedSeconds)}`}
              </SiteText>
              <SiteText
                type="supporting"
                color="secondary"
                role="status"
                aria-live="polite"
                className="site-clip__status"
                data-clip-status="true"
              >
                {copy.readyStatus}
              </SiteText>
            </HStack>

            <HStack align="center" gap={2} className="site-clip__right">
              <SiteButton
                label={`${copy.speed}: 1x`}
                aria-label={`${copy.speed}: 1x`}
                variant="ghost"
                size="sm"
                className="site-clip__speed"
                data-clip-speed="true"
              >
                1x
              </SiteButton>

              <HStack
                align="center"
                gap={2}
                className="site-clip__volume-group"
              >
                <SiteIconButton
                  label={copy.mute}
                  icon={
                    <SiteIcon icon={VolumeGlyph} size="sm" color="inherit" />
                  }
                  variant="ghost"
                  size="sm"
                  aria-pressed={false}
                  className="site-clip__mute"
                  data-clip-mute="true"
                />
                <VStack
                  role="slider"
                  tabIndex={0}
                  aria-label={copy.volume}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={100}
                  aria-valuetext="100%"
                  className="site-clip__volume"
                  data-clip-volume="true"
                >
                  <VStack
                    className="site-clip__volume-track"
                    aria-hidden="true"
                  >
                    <VStack
                      className="site-clip__volume-fill"
                      data-clip-volume-fill="true"
                    />
                  </VStack>
                </VStack>
              </HStack>

              <SiteIconButton
                label={copy.fullscreen}
                icon={
                  <SiteIcon icon={FullscreenGlyph} size="sm" color="inherit" />
                }
                variant="ghost"
                size="sm"
                className="site-clip__fullscreen"
                data-clip-fullscreen="true"
              />
            </HStack>
          </HStack>
        </VStack>
      </VStack>
    </VStack>
  );
}
