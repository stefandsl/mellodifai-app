// Vanilla interactive island for /recipes/<slug>: custom clip player controls
// (play/pause, timeline seek, playback speed, mute/volume, fullscreen, keyboard shortcuts)
// and horizontal more-recipes scroll arrows. Zero React or Astryx runtime code.
import { formatClipTime } from "../recipe-detail-helpers";
import { initShell } from "./shell";

type ClipPlayerConfig = {
  slug: string;
  isVideo: boolean;
  speeds: number[];
  copy: {
    play: string;
    pause: string;
    speed: string;
    mute: string;
    fullscreen: string;
    exitFullscreen: string;
    readyStatus: string;
    playingStatus: string;
    pausedStatus: string;
    of: string;
  };
};

type IconName =
  | "play"
  | "pause"
  | "volume"
  | "mute"
  | "fullscreen"
  | "exit-fullscreen";

function cloneClipIcon(name: IconName): Node | null {
  const tpl = document.querySelector<HTMLTemplateElement>(
    `template[data-clip-icon="${name}"]`,
  );
  if (!tpl) return null;
  const svg = tpl.content.firstElementChild;
  return svg ? svg.cloneNode(true) : null;
}

function swapButtonIcon(
  button: HTMLButtonElement | null,
  name: IconName,
): void {
  if (!button) return;
  const next = cloneClipIcon(name);
  if (!next) return;
  const current = button.querySelector("svg");
  if (current) {
    current.replaceWith(next);
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function formatSpeedLabel(rate: number): string {
  return `${rate}x`;
}

function bindSliderInteraction(
  slider: HTMLElement,
  onRatio: (ratio: number) => void,
  onKeyStep: (key: string) => boolean,
): void {
  const ratioFromClientX = (clientX: number) => {
    const rect = slider.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  let dragging = false;

  slider.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragging = true;
    slider.focus();
    if (typeof slider.setPointerCapture === "function") {
      try {
        slider.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointer events in jsdom may not register a pointerId.
      }
    }
    onRatio(ratioFromClientX(e.clientX));
  });

  slider.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    onRatio(ratioFromClientX(e.clientX));
  });

  const endDrag = () => {
    dragging = false;
  };
  slider.addEventListener("pointerup", endDrag);
  slider.addEventListener("pointercancel", endDrag);

  slider.addEventListener("keydown", (e) => {
    if (onKeyStep(e.key)) {
      e.preventDefault();
    }
  });
}

export function initClipPlayer(): void {
  const shells = document.querySelectorAll<HTMLElement>("[data-clip-player]");
  for (const shell of shells) {
    const raw = shell.getAttribute("data-clip-player");
    if (!raw) continue;
    let config: ClipPlayerConfig;
    try {
      config = JSON.parse(raw) as ClipPlayerConfig;
    } catch {
      continue;
    }

    const media = shell.querySelector<HTMLMediaElement>("[data-clip-media]");
    const stage = shell.querySelector<HTMLElement>("[data-clip-stage]");
    const playBtn = shell.querySelector<HTMLButtonElement>("[data-clip-play]");
    const seekSlider = shell.querySelector<HTMLElement>("[data-clip-seek]");
    const seekFill = shell.querySelector<HTMLElement>("[data-clip-seek-fill]");
    const timeEl = shell.querySelector<HTMLElement>("[data-clip-time]");
    const statusEl = shell.querySelector<HTMLElement>("[data-clip-status]");
    const speedBtn =
      shell.querySelector<HTMLButtonElement>("[data-clip-speed]");
    const muteBtn = shell.querySelector<HTMLButtonElement>("[data-clip-mute]");
    const volSlider = shell.querySelector<HTMLElement>("[data-clip-volume]");
    const volFill = shell.querySelector<HTMLElement>("[data-clip-volume-fill]");
    const fsBtn = shell.querySelector<HTMLButtonElement>(
      "[data-clip-fullscreen]",
    );
    if (!media) continue;

    const speeds =
      Array.isArray(config.speeds) && config.speeds.length > 0
        ? config.speeds
        : [0.5, 0.75, 1, 1.25, 1.5, 2];
    const fallbackDuration = Number(
      seekSlider?.getAttribute("aria-valuemax") ?? "0",
    );
    let lastNonZeroVolume = 1;
    let speedIndex = Math.max(0, speeds.indexOf(1));

    const effectiveDuration = () => {
      const d = media.duration;
      if (Number.isFinite(d) && d > 0) return d;
      return Number.isFinite(fallbackDuration) && fallbackDuration > 0
        ? fallbackDuration
        : 0;
    };

    const syncTimeline = () => {
      const dur = effectiveDuration();
      const cur = Number.isFinite(media.currentTime) ? media.currentTime : 0;
      const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
      if (seekFill) {
        seekFill.style.setProperty("--clip-seek-pct", `${pct.toFixed(2)}%`);
      }
      const curText = formatClipTime(cur);
      const durText = formatClipTime(dur);
      if (timeEl) {
        timeEl.textContent = `${curText} / ${durText}`;
      }
      if (seekSlider) {
        seekSlider.setAttribute("aria-valuemax", String(Math.round(dur)));
        seekSlider.setAttribute("aria-valuenow", String(Math.round(cur)));
        seekSlider.setAttribute(
          "aria-valuetext",
          `${curText} ${config.copy.of} ${durText}`,
        );
      }
    };

    const syncPlayState = (playing: boolean) => {
      shell.setAttribute("data-playing", String(playing));
      if (playing && config.isVideo) {
        shell.setAttribute("data-video-active", "true");
      }
      if (playBtn) {
        playBtn.setAttribute(
          "aria-label",
          playing ? config.copy.pause : config.copy.play,
        );
        swapButtonIcon(playBtn, playing ? "pause" : "play");
      }
      if (statusEl) {
        statusEl.textContent = playing
          ? config.copy.playingStatus
          : media.currentTime > 0
            ? config.copy.pausedStatus
            : config.copy.readyStatus;
      }
    };

    const syncSpeed = (nextIndex: number) => {
      speedIndex =
        ((nextIndex % speeds.length) + speeds.length) % speeds.length;
      const rate = speeds[speedIndex] ?? 1;
      media.playbackRate = rate;
      shell.setAttribute("data-speed", String(rate));
      if (speedBtn) {
        const label = formatSpeedLabel(rate);
        const textTarget = speedBtn.querySelector("span > span");
        if (textTarget) {
          textTarget.textContent = label;
        } else {
          speedBtn.textContent = label;
        }
        speedBtn.setAttribute("aria-label", `${config.copy.speed}: ${label}`);
      }
    };

    const syncVolume = () => {
      const muted = media.muted || media.volume === 0;
      const pct = muted ? 0 : Math.round(media.volume * 100);
      shell.setAttribute("data-muted", String(muted));
      if (muteBtn) {
        muteBtn.setAttribute("aria-pressed", String(muted));
        muteBtn.setAttribute("aria-label", config.copy.mute);
        swapButtonIcon(muteBtn, muted ? "mute" : "volume");
      }
      if (volFill) {
        volFill.style.setProperty("--clip-vol-pct", `${pct}%`);
      }
      if (volSlider) {
        volSlider.setAttribute("aria-valuenow", String(pct));
        volSlider.setAttribute("aria-valuetext", `${pct}%`);
      }
    };

    const syncFullscreen = () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
      };
      const active =
        doc.fullscreenElement === shell ||
        doc.webkitFullscreenElement === shell;
      shell.setAttribute("data-fullscreen", String(active));
      if (fsBtn) {
        fsBtn.setAttribute(
          "aria-label",
          active ? config.copy.exitFullscreen : config.copy.fullscreen,
        );
        swapButtonIcon(fsBtn, active ? "exit-fullscreen" : "fullscreen");
      }
    };

    const togglePlay = async () => {
      if (!media.paused && !media.ended) {
        media.pause();
        syncPlayState(false);
        return;
      }
      if (config.isVideo) {
        shell.setAttribute("data-video-active", "true");
      }
      try {
        await media.play();
        syncPlayState(true);
      } catch {
        syncPlayState(false);
      }
    };

    const seekTo = (seconds: number) => {
      const dur = effectiveDuration();
      const clamped = Math.min(dur, Math.max(0, seconds));
      try {
        media.currentTime = clamped;
      } catch {
        // Ignore if media has not loaded metadata yet.
      }
      syncTimeline();
    };

    const toggleMute = () => {
      if (media.muted || media.volume === 0) {
        media.muted = false;
        if (media.volume === 0) {
          media.volume = lastNonZeroVolume > 0 ? lastNonZeroVolume : 1;
        }
      } else {
        lastNonZeroVolume = media.volume;
        media.muted = true;
      }
      syncVolume();
    };

    const setVolumePercent = (pct: number) => {
      const clamped = Math.min(100, Math.max(0, Math.round(pct)));
      media.volume = clamped / 100;
      if (clamped > 0) {
        lastNonZeroVolume = media.volume;
        media.muted = false;
      } else {
        media.muted = true;
      }
      syncVolume();
    };

    const toggleFullscreen = async () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitExitFullscreen?: () => Promise<void> | void;
      };
      const el = shell as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      try {
        if (
          doc.fullscreenElement === shell ||
          doc.webkitFullscreenElement === shell
        ) {
          if (typeof doc.exitFullscreen === "function") {
            await doc.exitFullscreen();
          } else if (typeof doc.webkitExitFullscreen === "function") {
            await doc.webkitExitFullscreen();
          }
        } else if (typeof el.requestFullscreen === "function") {
          await el.requestFullscreen();
        } else if (typeof el.webkitRequestFullscreen === "function") {
          await el.webkitRequestFullscreen();
        }
      } catch {
        // Fullscreen may be disallowed in headless or embedded contexts.
      }
      syncFullscreen();
    };

    playBtn?.addEventListener("click", () => {
      void togglePlay();
    });

    stage?.addEventListener("click", () => {
      void togglePlay();
    });

    speedBtn?.addEventListener("click", () => {
      syncSpeed(speedIndex + 1);
    });

    speedBtn?.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowRight") {
        e.preventDefault();
        syncSpeed(Math.min(speeds.length - 1, speedIndex + 1));
      } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
        e.preventDefault();
        syncSpeed(Math.max(0, speedIndex - 1));
      }
    });

    muteBtn?.addEventListener("click", toggleMute);

    fsBtn?.addEventListener("click", () => {
      void toggleFullscreen();
    });

    if (seekSlider) {
      bindSliderInteraction(
        seekSlider,
        (ratio) => seekTo(ratio * effectiveDuration()),
        (key) => {
          const dur = effectiveDuration();
          const step = dur > 0 && dur <= 15 ? 1 : 5;
          if (key === "ArrowRight" || key === "ArrowUp") {
            seekTo(media.currentTime + step);
            return true;
          }
          if (key === "ArrowLeft" || key === "ArrowDown") {
            seekTo(media.currentTime - step);
            return true;
          }
          if (key === "PageUp") {
            seekTo(media.currentTime + 10);
            return true;
          }
          if (key === "PageDown") {
            seekTo(media.currentTime - 10);
            return true;
          }
          if (key === "Home") {
            seekTo(0);
            return true;
          }
          if (key === "End") {
            seekTo(dur);
            return true;
          }
          return false;
        },
      );
    }

    if (volSlider) {
      bindSliderInteraction(
        volSlider,
        (ratio) => setVolumePercent(ratio * 100),
        (key) => {
          const currentPct = media.muted ? 0 : Math.round(media.volume * 100);
          if (key === "ArrowRight" || key === "ArrowUp") {
            setVolumePercent(currentPct + 10);
            return true;
          }
          if (key === "ArrowLeft" || key === "ArrowDown") {
            setVolumePercent(currentPct - 10);
            return true;
          }
          if (key === "Home") {
            setVolumePercent(0);
            return true;
          }
          if (key === "End") {
            setVolumePercent(100);
            return true;
          }
          return false;
        },
      );
    }

    shell.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        void togglePlay();
      } else if (key === "m") {
        e.preventDefault();
        toggleMute();
      } else if (key === "f") {
        e.preventDefault();
        void toggleFullscreen();
      }
    });

    media.addEventListener("loadedmetadata", syncTimeline);
    media.addEventListener("durationchange", syncTimeline);
    media.addEventListener("timeupdate", syncTimeline);
    media.addEventListener("play", () => syncPlayState(true));
    media.addEventListener("pause", () => syncPlayState(false));
    media.addEventListener("ended", () => {
      syncPlayState(false);
      syncTimeline();
    });
    media.addEventListener("volumechange", syncVolume);
    document.addEventListener("fullscreenchange", syncFullscreen);

    // Sync initial visual state without autoplaying or triggering network fetches.
    syncTimeline();
    syncVolume();
    syncFullscreen();
  }
}

export function initCardRow(): void {
  const rows = document.querySelectorAll<HTMLElement>("[data-card-row]");
  for (const row of rows) {
    const track = row.querySelector<HTMLElement>("[data-card-row-track]");
    const prev = row.querySelector<HTMLButtonElement>("[data-card-row-prev]");
    const next = row.querySelector<HTMLButtonElement>("[data-card-row-next]");
    if (!track || !prev || !next) continue;

    const updateButtons = () => {
      const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
      prev.disabled = track.scrollLeft <= 1;
      next.disabled = maxScroll > 0 && track.scrollLeft >= maxScroll - 1;
    };

    const scrollStep = (dir: -1 | 1) => {
      const firstCard = track.firstElementChild as HTMLElement | null;
      const step = (firstCard?.getBoundingClientRect().width || 391) + 12;
      const behavior: ScrollBehavior = prefersReducedMotion()
        ? "auto"
        : "smooth";
      if (typeof track.scrollBy === "function") {
        track.scrollBy({ left: dir * step, behavior });
      } else {
        track.scrollLeft = Math.max(0, track.scrollLeft + dir * step);
      }
      updateButtons();
    };

    prev.addEventListener("click", () => scrollStep(-1));
    next.addEventListener("click", () => scrollStep(1));
    track.addEventListener("scroll", updateButtons, { passive: true });
    window.addEventListener("resize", updateButtons, { passive: true });
    updateButtons();
  }
}

export function initRecipeDetail(): void {
  initShell();
  initClipPlayer();
  initCardRow();
}

if (
  typeof window !== "undefined" &&
  !("__SITE_ISLAND_MANUAL_INIT__" in window)
) {
  initRecipeDetail();
}
