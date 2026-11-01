// Draws the twelve royalty-free "Casuale" backgrounds of the Video Studio (our own procedural
// pictures, no third-party images) into packages/visualizer/stock/bg-NN.jpg.
//   node scripts/stock-backgrounds.mjs
// Then upload them with apps/worker/scripts/visualizer-stock.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const { chromium } = require("@playwright/test");
const out = join(root, "stock");
mkdirSync(out, { recursive: true });

// Runs in the page: one scene per index, all from a seeded random source.
function scene(index) {
  const W = 1920;
  const H = 1080;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  let seed = 1000 + index * 7919;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const sky = (stops) => {
    const s = g.createLinearGradient(0, 0, 0, H);
    for (const [o, col] of stops) s.addColorStop(o, col);
    g.fillStyle = s;
    g.fillRect(0, 0, W, H);
  };
  const glow = (x, y, r, col, a = 1) => {
    const s = g.createRadialGradient(x, y, 0, x, y, r);
    s.addColorStop(0, col);
    s.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = a;
    g.fillStyle = s;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.globalAlpha = 1;
  };
  const stars = (n, maxY) => {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = 0.3 + rnd() * 0.7;
      g.fillStyle = "#fff";
      const s = rnd() * 1.8 + 0.3;
      g.fillRect(rnd() * W, rnd() * maxY, s, s);
    }
    g.globalAlpha = 1;
  };
  const skyline = (base, layers, warm, cool) => {
    for (let l = 0; l < layers; l++) {
      const depth = l / layers;
      let x = -20;
      while (x < W) {
        const w = 40 + rnd() * 120;
        const h = (0.12 + rnd() * 0.38) * H * (1 - depth * 0.45);
        const top = base - h;
        const shade = Math.round(8 + depth * 18);
        g.fillStyle = `rgb(${shade},${shade + 2},${shade + 10})`;
        g.fillRect(x, top, w, base - top + 2);
        if (rnd() > 0.7) {
          g.fillRect(x + w * 0.45, top - 30 - rnd() * 60, 3, 40 + rnd() * 60);
        }
        for (let wy = top + 10; wy < base - 8; wy += 14)
          for (let wx = x + 6; wx < x + w - 6; wx += 11)
            if (rnd() > 0.62) {
              g.fillStyle = rnd() > 0.35 ? warm : cool;
              g.globalAlpha = 0.35 + rnd() * 0.6 - depth * 0.3;
              g.fillRect(wx, wy, 5, 7);
              g.globalAlpha = 1;
            }
        x += w + rnd() * 10;
      }
    }
  };
  const mountains = (base, amp, col, rough) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, H);
    let y = base;
    for (let x = 0; x <= W; x += 8) {
      y += (rnd() - 0.5) * rough;
      y = Math.max(base - amp, Math.min(base + amp * 0.3, y));
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.fill();
  };
  switch (index % 12) {
    case 0: // Night city, warm street lights and cyan towers.
      sky([
        [0, "#05070f"],
        [0.55, "#0d1b33"],
        [0.8, "#3a2a2f"],
        [1, "#120a08"],
      ]);
      stars(260, H * 0.5);
      glow(W * 0.5, H * 0.85, 900, "rgba(255,140,60,0.35)");
      skyline(H * 0.92, 3, "#ffc46b", "#5ce1ff");
      glow(W * 0.3, H * 0.95, 400, "rgba(255,170,80,0.3)");
      break;
    case 1: // Bokeh lights on deep blue.
      sky([
        [0, "#020313"],
        [1, "#0b1238"],
      ]);
      for (let i = 0; i < 90; i++) {
        const cols = [
          "rgba(255,90,140,0.5)",
          "rgba(90,180,255,0.5)",
          "rgba(255,200,90,0.45)",
          "rgba(160,110,255,0.45)",
        ];
        glow(
          rnd() * W,
          rnd() * H,
          30 + rnd() * 140,
          cols[i % 4],
          0.6 + rnd() * 0.4,
        );
      }
      break;
    case 2: // Aurora over a frozen ridge.
      sky([
        [0, "#01040b"],
        [1, "#071a26"],
      ]);
      stars(400, H * 0.7);
      for (let b = 0; b < 5; b++) {
        g.globalAlpha = 0.18;
        g.strokeStyle = b % 2 ? "#38ffb0" : "#4fd2ff";
        g.lineWidth = 120 - b * 15;
        g.filter = "blur(30px)";
        g.beginPath();
        for (let x = -50; x <= W + 50; x += 20) {
          const y =
            H * (0.28 + b * 0.05) +
            Math.sin(x / 260 + b) * 70 +
            Math.sin(x / 90 + b * 2) * 18;
          if (x === -50) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      g.filter = "none";
      g.globalAlpha = 1;
      mountains(H * 0.78, 160, "#04080d", 26);
      break;
    case 3: // Synthwave grid and sun.
      sky([
        [0, "#12011f"],
        [0.55, "#3d0a4f"],
        [0.56, "#08000f"],
        [1, "#08000f"],
      ]);
      stars(150, H * 0.45);
      {
        const sun = g.createLinearGradient(0, H * 0.18, 0, H * 0.56);
        sun.addColorStop(0, "#ffd36b");
        sun.addColorStop(1, "#ff2e93");
        g.fillStyle = sun;
        g.beginPath();
        g.arc(W / 2, H * 0.48, 260, Math.PI, 0);
        g.fill();
        g.fillStyle = "#3d0a4f";
        for (let i = 0; i < 7; i++)
          g.fillRect(W / 2 - 270, H * 0.36 + i * 18 + i * i * 1.5, 540, 4 + i);
      }
      g.strokeStyle = "rgba(255,46,200,0.7)";
      g.lineWidth = 2;
      for (let i = -20; i <= 20; i++) {
        g.beginPath();
        g.moveTo(W / 2 + i * 30, H * 0.56);
        g.lineTo(W / 2 + i * 220, H);
        g.stroke();
      }
      for (let i = 0; i < 14; i++) {
        const y = H * 0.56 + i * i * 2.6;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
      }
      break;
    case 4: // Ocean at dusk.
      sky([
        [0, "#1a1035"],
        [0.45, "#b8466a"],
        [0.6, "#ff9f6b"],
        [0.61, "#2a1f3d"],
        [1, "#0a0a18"],
      ]);
      glow(W * 0.62, H * 0.58, 380, "rgba(255,200,140,0.8)");
      for (let y = H * 0.62; y < H; y += 6) {
        g.globalAlpha = 0.25;
        g.fillStyle = "#ffb88a";
        const w = 40 + rnd() * 300 * (1 - (y - H * 0.6) / H);
        g.fillRect(W * 0.62 - w / 2 + (rnd() - 0.5) * 80, y, w, 2);
      }
      g.globalAlpha = 1;
      break;
    case 5: // Nebula.
      sky([
        [0, "#030007"],
        [1, "#07020f"],
      ]);
      for (let i = 0; i < 40; i++)
        glow(
          W * (0.2 + rnd() * 0.6),
          H * (0.2 + rnd() * 0.6),
          120 + rnd() * 380,
          [
            "rgba(180,60,255,0.25)",
            "rgba(40,120,255,0.22)",
            "rgba(255,60,120,0.2)",
          ][i % 3],
        );
      stars(700, H);
      break;
    case 6: // Mountains under a moon.
      sky([
        [0, "#0b1430"],
        [0.7, "#2a3a6b"],
        [1, "#0b1020"],
      ]);
      stars(300, H * 0.6);
      glow(W * 0.75, H * 0.22, 180, "rgba(255,250,230,0.9)");
      g.fillStyle = "#f6f1df";
      g.beginPath();
      g.arc(W * 0.75, H * 0.22, 60, 0, Math.PI * 2);
      g.fill();
      mountains(H * 0.6, 200, "#1b2547", 30);
      mountains(H * 0.72, 160, "#121a33", 34);
      mountains(H * 0.84, 120, "#080d1c", 40);
      break;
    case 7: // Neon tunnel.
      sky([
        [0, "#020205"],
        [1, "#020205"],
      ]);
      for (let i = 30; i > 0; i--) {
        const s = i / 30;
        g.strokeStyle = i % 2 ? "#ff2e93" : "#00e5ff";
        g.globalAlpha = 0.15 + (1 - s) * 0.6;
        g.lineWidth = 3;
        g.strokeRect(
          W / 2 - (W / 2) * s * s,
          H / 2 - (H / 2) * s * s,
          W * s * s,
          H * s * s,
        );
      }
      g.globalAlpha = 1;
      glow(W / 2, H / 2, 260, "rgba(255,255,255,0.35)");
      break;
    case 8: // Concert haze with light beams.
      sky([
        [0, "#06030a"],
        [1, "#160818"],
      ]);
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 9; i++) {
        const x = W * (0.1 + i * 0.1);
        const beam = g.createLinearGradient(x, 0, W / 2, H);
        beam.addColorStop(
          0,
          [
            "rgba(255,40,80,0.35)",
            "rgba(80,120,255,0.35)",
            "rgba(255,180,40,0.3)",
          ][i % 3],
        );
        beam.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = beam;
        g.beginPath();
        g.moveTo(x - 10, 0);
        g.lineTo(x + 10, 0);
        g.lineTo(W / 2 + (i - 4) * 160 + 120, H);
        g.lineTo(W / 2 + (i - 4) * 160 - 120, H);
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
      g.fillStyle = "#050205";
      for (let i = 0; i < 60; i++) {
        const x = rnd() * W;
        const r = 26 + rnd() * 18;
        g.beginPath();
        g.arc(x, H - 40 + rnd() * 20, r, 0, Math.PI * 2);
        g.fill();
        g.fillRect(x - r, H - 40, r * 2, 60);
      }
      break;
    case 9: // Rainy window lights.
      sky([
        [0, "#0a0f14"],
        [1, "#16202a"],
      ]);
      for (let i = 0; i < 70; i++)
        glow(
          rnd() * W,
          H * (0.3 + rnd() * 0.7),
          40 + rnd() * 120,
          [
            "rgba(255,170,90,0.45)",
            "rgba(255,90,90,0.35)",
            "rgba(120,200,255,0.35)",
          ][i % 3],
        );
      g.strokeStyle = "rgba(200,220,255,0.18)";
      for (let i = 0; i < 500; i++) {
        const x = rnd() * W;
        const y = rnd() * H;
        g.lineWidth = 1 + rnd();
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - 6, y + 30 + rnd() * 40);
        g.stroke();
      }
      break;
    case 10: // Desert road at night.
      sky([
        [0, "#0a0c1e"],
        [0.6, "#3b2550"],
        [0.62, "#1a1020"],
        [1, "#0c0810"],
      ]);
      stars(350, H * 0.55);
      mountains(H * 0.62, 70, "#150c1c", 14);
      g.fillStyle = "#0f0a12";
      g.beginPath();
      g.moveTo(W / 2 - 8, H * 0.62);
      g.lineTo(W / 2 + 8, H * 0.62);
      g.lineTo(W * 0.85, H);
      g.lineTo(W * 0.15, H);
      g.fill();
      g.fillStyle = "#ffd36b";
      for (let i = 0; i < 9; i++) {
        const t = i / 9;
        const y = H * 0.62 + H * 0.38 * t * t;
        g.fillRect(W / 2 - 2 - t * 6, y, 4 + t * 12, 8 + t * 40);
      }
      break;
    default: // Warm studio gradient with soft orbs.
      sky([
        [0, "#1c0b05"],
        [0.5, "#4a1a0c"],
        [1, "#0d0503"],
      ]);
      for (let i = 0; i < 14; i++)
        glow(rnd() * W, rnd() * H, 200 + rnd() * 400, "rgba(255,120,60,0.25)");
      glow(W * 0.3, H * 0.4, 500, "rgba(255,60,60,0.25)");
  }
  // Soft grain so wide gradients do not band after compression.
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 6;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL("image/jpeg", 0.86);
}

const browser = await chromium.launch();
const page = await browser.newPage();
for (let i = 0; i < 12; i++) {
  const data = await page.evaluate(scene, i);
  const file = join(out, `bg-${String(i + 1).padStart(2, "0")}.jpg`);
  writeFileSync(file, Buffer.from(data.split(",")[1], "base64"));
  console.log(file);
}
await browser.close();
