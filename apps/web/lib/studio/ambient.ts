export type Color = [number, number, number];

export const GLASS_SCRIPT = `try{if(localStorage.getItem("mellodifai-glass")==="on")document.documentElement.classList.add("glass")}catch(e){}`;

function luminance(color: Color): number {
  const [r, g, b] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: Color, b: Color): number {
  const high = Math.max(luminance(a), luminance(b));
  const low = Math.min(luminance(a), luminance(b));
  return (high + 0.05) / (low + 0.05);
}

export function guardColor(color: Color, light: boolean): Color {
  const ink: Color = light ? [20, 20, 22] : [247, 244, 239];
  const base: Color = light ? [246, 244, 241] : [16, 16, 18];
  const subtleAlpha = light ? 0.64 : 0.56;
  for (let mix = 0; mix <= 1; mix += 0.05) {
    const guarded = color.map((value, index) =>
      Math.round(value * (1 - mix) + base[index] * mix),
    ) as Color;
    const subtle = ink.map((value, index) =>
      Math.round(value * subtleAlpha + guarded[index] * (1 - subtleAlpha)),
    ) as Color;
    if (contrast(guarded, ink) >= 7 && contrast(guarded, subtle) >= 4.5)
      return guarded;
  }
  return base;
}

export function coverColors(data: ImageData): Color[] {
  const sums = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
  for (let y = 0; y < data.height; y += 2) {
    for (let x = 0; x < data.width; x += 2) {
      const offset = (y * data.width + x) * 4;
      if (data.data[offset + 3] < 128) continue;
      const bucket = Math.min(2, Math.floor((x / data.width) * 3));
      const sum = sums[bucket];
      for (let channel = 0; channel < 3; channel++)
        sum[channel] += data.data[offset + channel];
      sum[3]++;
    }
  }
  return sums.map(
    (sum) =>
      (sum[3]
        ? sum.slice(0, 3).map((value) => Math.round(value / sum[3]))
        : [60, 44, 68]) as Color,
  );
}

export function colorCss(color: Color): string {
  return `rgb(${color.join(" ")})`;
}
