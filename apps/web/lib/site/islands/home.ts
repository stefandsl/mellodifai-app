// Interactive islands for the public home page:
// shell (header scroll, agents menu, phone menu, deferred fonts),
// hero lyric word chips + audio preview, recipe kinds stage, period switch, and FAQ collapsibles.
import { initPeriodSwitch } from "./period-switch";
import { initShell, onAfterFirstPaint } from "./shell";

type HeroConfig = {
  first: string;
  clips: Record<string, string>;
  play: string;
  pause: string;
  ready: string;
  missing: string;
  nowPlaying: string;
  lineStart: string;
};

type KindItem = {
  name: string;
  line: string;
  kind: string;
  rings: [number, number, number][];
};

type HomeStateClasses = {
  disabledButton: string[];
  panelClosed: string[];
  panelOpen: string[];
  chevronOpen: string[];
  chevronClosed: string[];
};

const SVG_NS = "http://www.w3.org/2000/svg";

function readHomeStateClasses(): HomeStateClasses {
  const el = document.getElementById("site-home-classes");
  if (el?.textContent) {
    try {
      const parsed = JSON.parse(el.textContent) as Partial<HomeStateClasses>;
      return {
        disabledButton: Array.isArray(parsed.disabledButton)
          ? parsed.disabledButton
          : [],
        panelClosed: Array.isArray(parsed.panelClosed)
          ? parsed.panelClosed
          : [],
        panelOpen: Array.isArray(parsed.panelOpen) ? parsed.panelOpen : [],
        chevronOpen: Array.isArray(parsed.chevronOpen)
          ? parsed.chevronOpen
          : [],
        chevronClosed: Array.isArray(parsed.chevronClosed)
          ? parsed.chevronClosed
          : [],
      };
    } catch {
      // Fall through to empty defaults.
    }
  }
  return {
    disabledButton: [],
    panelClosed: [],
    panelOpen: [],
    chevronOpen: [],
    chevronClosed: [],
  };
}

function diffToggleClasses(buttons: HTMLButtonElement[]) {
  const pressed =
    buttons.find((b) => b.getAttribute("aria-pressed") === "true") ??
    buttons[0];
  const unpressed = buttons.find((b) => b !== pressed) ?? buttons[1];
  if (!pressed || !unpressed) return { pressedOnly: [], unpressedOnly: [] };
  const pSet = new Set(pressed.classList);
  const uSet = new Set(unpressed.classList);
  return {
    pressedOnly: [...pSet].filter((c) => !uSet.has(c)),
    unpressedOnly: [...uSet].filter((c) => !pSet.has(c)),
  };
}

function setTogglePressed(
  buttons: HTMLButtonElement[],
  activeIdx: number,
  pressedOnly: string[],
  unpressedOnly: string[],
) {
  for (let i = 0; i < buttons.length; i++) {
    const isPressed = i === activeIdx;
    const btn = buttons[i];
    btn.setAttribute("aria-pressed", String(isPressed));
    for (const c of pressedOnly) btn.classList.toggle(c, isPressed);
    for (const c of unpressedOnly) btn.classList.toggle(c, !isPressed);
  }
}

function initHeroStudio(stateClasses: HomeStateClasses): void {
  const figure = document.querySelector<HTMLElement>(
    "figure.site-studio[data-hero-studio]",
  );
  if (!figure) return;
  const raw = figure.getAttribute("data-hero-studio");
  if (!raw) return;

  let cfg: HeroConfig;
  try {
    cfg = JSON.parse(raw) as HeroConfig;
  } catch {
    return;
  }

  const chips = Array.from(
    figure.querySelectorAll<HTMLButtonElement>(
      ".site-studio__words .site-chip",
    ),
  );
  const playBtn = figure.querySelector<HTMLButtonElement>(".site-studio__play");
  const audio = figure.querySelector<HTMLAudioElement>(
    "audio.site-studio__audio",
  );
  const wordBox = figure.querySelector<HTMLElement>(".site-studio__word");
  const dot = figure.querySelector<HTMLElement>(".site-dot");
  const statusEl = figure.querySelector<HTMLElement>(
    '.site-studio__foot [role="status"]',
  );
  const waves = Array.from(
    figure.querySelectorAll<SVGSVGElement>("svg.site-wave"),
  );
  if (!chips.length || !playBtn || !audio || !wordBox) return;

  const { pressedOnly, unpressedOnly } = diffToggleClasses(chips);
  const playLabelSpan = playBtn.querySelector<HTMLElement>(
    "span > span:last-child",
  );
  const playIconTpl = document.querySelector<HTMLTemplateElement>(
    'template[data-hero-icon="play"]',
  );
  const pauseIconTpl = document.querySelector<HTMLTemplateElement>(
    'template[data-hero-icon="pause"]',
  );

  let word = figure.dataset.word || cfg.first;
  let state: "idle" | "playing" | "missing" = "idle";

  const renderPlayIcon = (playing: boolean) => {
    const tpl = playing ? pauseIconTpl : playIconTpl;
    const nextSvg = tpl?.content.querySelector("svg");
    const curSvg = playBtn.querySelector<SVGSVGElement>("svg");
    if (!nextSvg || !curSvg) return;
    curSvg.replaceWith(nextSvg.cloneNode(true));
  };

  const renderState = () => {
    const label = state === "playing" ? cfg.pause : cfg.play;
    playBtn.setAttribute("data-state", state);
    const isMissing = state === "missing";
    playBtn.disabled = isMissing;
    if (isMissing) {
      playBtn.setAttribute("aria-disabled", "true");
    } else {
      playBtn.removeAttribute("aria-disabled");
    }
    for (const cls of stateClasses.disabledButton) {
      playBtn.classList.toggle(cls, isMissing);
    }
    if (playBtn.hasAttribute("aria-label")) {
      playBtn.setAttribute("aria-label", label);
    }
    if (playLabelSpan) playLabelSpan.textContent = label;
    renderPlayIcon(state === "playing");

    if (dot) {
      dot.classList.toggle("site-dot--muted", state === "missing");
      dot.classList.toggle("site-dot--live", state !== "missing");
    }
    if (statusEl) {
      statusEl.textContent =
        state === "missing"
          ? cfg.missing
          : state === "playing"
            ? `${cfg.nowPlaying}: ${cfg.lineStart} ${word}`
            : cfg.ready;
    }
  };

  const renderWord = () => {
    const edited = word !== cfg.first;
    figure.dataset.word = word;
    wordBox.classList.toggle("is-edited", edited);
    wordBox.replaceChildren();
    if (edited) {
      const del = document.createElement("del");
      del.className = "site-studio__old";
      del.textContent = cfg.first;
      wordBox.appendChild(del);
    }
    const ins = document.createElement("ins");
    ins.className = "site-studio__new";
    ins.textContent = word;
    wordBox.appendChild(ins);

    for (let i = 0; i < 2; i++) {
      const wave = waves[i];
      if (!wave) continue;
      const existing = wave.querySelector("rect.site-wave__take");
      if (edited && !existing) {
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("class", "site-wave__take");
        rect.setAttribute("x", String(0.62 * 960));
        rect.setAttribute("width", String((0.79 - 0.62) * 960));
        rect.setAttribute("y", "0");
        rect.setAttribute("height", "100");
        wave.appendChild(rect);
      } else if (!edited && existing) {
        existing.remove();
      }
    }
  };

  // Check sample availability after first paint so the HEAD probe never competes with LCP.
  onAfterFirstPaint(() => {
    fetch(cfg.clips[cfg.first], { method: "HEAD" })
      .then((res) => {
        if (!res.ok) {
          state = "missing";
          renderState();
        }
      })
      .catch(() => {});
  });

  audio.addEventListener("ended", () => {
    if (state === "playing") {
      state = "idle";
      renderState();
    }
  });
  audio.addEventListener("error", () => {
    state = "missing";
    renderState();
  });

  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i];
    chip.addEventListener("click", () => {
      const next =
        chip.querySelector(".site-chip__word")?.textContent?.trim() || "";
      if (!next || next === word) return;
      word = next;
      setTogglePressed(chips, i, pressedOnly, unpressedOnly);
      if (state === "playing") {
        audio.pause();
        state = "idle";
      }
      renderWord();
      renderState();
    });
  }

  playBtn.addEventListener("click", async () => {
    if (state === "missing") return;
    if (state === "playing") {
      audio.pause();
      state = "idle";
      renderState();
      return;
    }
    const src = cfg.clips[word];
    if (src && !audio.src.endsWith(src)) audio.src = src;
    try {
      await audio.play();
      state = "playing";
    } catch {
      state = "missing";
    }
    renderState();
  });
}

function initKindsStage(): void {
  const body = document.querySelector<HTMLElement>(
    ".site-kinds__body[data-kinds-stage]",
  );
  if (!body) return;
  const raw = body.getAttribute("data-kinds-stage");
  if (!raw) return;

  let items: KindItem[];
  try {
    items = JSON.parse(raw) as KindItem[];
  } catch {
    return;
  }

  const buttons = Array.from(
    body.querySelectorAll<HTMLButtonElement>(".site-kinds__name"),
  );
  const cover = body.querySelector<HTMLElement>(".site-kinds__cover");
  const coverSvg = cover?.querySelector<SVGSVGElement>("svg.site-cover__art");
  const titleEl = body.querySelector<HTMLElement>(".site-kinds__title");
  const lineEl = body.querySelector<HTMLElement>(
    '.site-kinds__caption [aria-live="polite"]',
  );
  if (!buttons.length || !cover || !coverSvg || !titleEl || !lineEl) return;

  const { pressedOnly, unpressedOnly } = diffToggleClasses(buttons);

  for (let i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", () => {
      const item = items[i];
      if (!item) return;
      setTogglePressed(buttons, i, pressedOnly, unpressedOnly);

      for (const cls of [...cover.classList]) {
        if (cls.startsWith("site-cover--")) cover.classList.remove(cls);
      }
      cover.classList.add(`site-cover--${item.kind}`);

      coverSvg.replaceChildren();
      for (const [cx, cy, n] of item.rings) {
        const g = document.createElementNS(SVG_NS, "g");
        for (let k = 0; k < n; k++) {
          const c = document.createElementNS(SVG_NS, "circle");
          c.setAttribute("cx", String(cx));
          c.setAttribute("cy", String(cy));
          c.setAttribute("r", String((k + 1) * 16));
          g.appendChild(c);
        }
        const dot = document.createElementNS(SVG_NS, "circle");
        dot.setAttribute("class", "site-cover__dot");
        dot.setAttribute("cx", String(cx));
        dot.setAttribute("cy", String(cy));
        dot.setAttribute("r", "3");
        g.appendChild(dot);
        coverSvg.appendChild(g);
      }

      titleEl.textContent = item.name;
      lineEl.textContent = item.line;
    });
  }
}

function initHomeFaq(stateClasses: HomeStateClasses): void {
  const triggers = document.querySelectorAll<HTMLButtonElement>(
    ".site-faq__item .astryx-collapsible-trigger[aria-controls]",
  );
  for (const btn of triggers) {
    const panelId = btn.getAttribute("aria-controls");
    if (!panelId) continue;
    const panel = document.getElementById(panelId);
    if (!panel) continue;
    const chevron = btn.querySelector<HTMLElement>(".astryx-icon");

    btn.addEventListener("click", () => {
      const nextOpen = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", String(nextOpen));
      for (const cls of stateClasses.panelClosed) {
        panel.classList.toggle(cls, !nextOpen);
      }
      for (const cls of stateClasses.panelOpen) {
        panel.classList.toggle(cls, nextOpen);
      }
      panel.hidden = !nextOpen;
      if (chevron) {
        for (const cls of stateClasses.chevronOpen) {
          chevron.classList.toggle(cls, nextOpen);
        }
        for (const cls of stateClasses.chevronClosed) {
          chevron.classList.toggle(cls, !nextOpen);
        }
      }
    });
  }
}

export function initHome(): void {
  const stateClasses = readHomeStateClasses();
  initShell();
  initHeroStudio(stateClasses);
  initKindsStage();
  initPeriodSwitch();
  initHomeFaq(stateClasses);
}

if (
  typeof window !== "undefined" &&
  !("__SITE_ISLAND_MANUAL_INIT__" in window)
) {
  initHome();
}
