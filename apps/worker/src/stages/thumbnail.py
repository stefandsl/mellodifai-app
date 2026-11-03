"""One title focal point over a softened frame from this song's video."""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

W, H = 1280, 720
MARGIN_X, MARGIN_Y = 80, 48
MIN_SIZE = 64  # 16 px when the thumbnail is shown at 320 px wide.
FONT_CANDIDATES = {
    "ja": ["C:/Windows/Fonts/meiryob.ttc"],
    "zh": ["C:/Windows/Fonts/msyhbd.ttc"],
    "ko": ["C:/Windows/Fonts/malgunbd.ttf"],
}
FALLBACK_FONTS = ["C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]


def font_for(lang, size):
    for candidate in FONT_CANDIDATES.get(lang, []) + FALLBACK_FONTS:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    raise RuntimeError("No thumbnail font found")


def wrap(title, font, draw):
    lines = []
    line = ""
    for word in title.split():
        candidate = f"{line} {word}".strip()
        if draw.textlength(candidate, font=font) <= W - 2 * MARGIN_X:
            line = candidate
            continue
        if line:
            lines.append(line)
        line = ""
        for char in word:
            if draw.textlength(line + char, font=font) > W - 2 * MARGIN_X:
                if line:
                    lines.append(line)
                line = char
            else:
                line += char
    if line:
        lines.append(line)
    return lines


def layout(title, lang):
    title = title.strip()
    if not title:
        raise ValueError("Thumbnail title is empty")
    draw = ImageDraw.Draw(Image.new("RGB", (W, H)))
    for size in range(112, MIN_SIZE - 1, -2):
        font = font_for(lang, size)
        lines = wrap(title, font, draw)
        spacing = round(size * 0.2)
        boxes = [draw.textbbox((0, 0), line, font=font, stroke_width=2) for line in lines]
        height = sum(box[3] - box[1] for box in boxes) + spacing * (len(lines) - 1)
        if height <= H - 2 * MARGIN_Y and all(box[2] - box[0] <= W - 2 * MARGIN_X for box in boxes):
            y = (H - height) // 2
            placements = []
            for line, box in zip(lines, boxes):
                placements.append((line, (W - (box[2] - box[0])) // 2 - box[0], y - box[1]))
                y += box[3] - box[1] + spacing
            bounds = [min(x for _, x, _ in placements), (H - height) // 2,
                      max(x + box[2] for (_, x, _), box in zip(placements, boxes)), (H + height) // 2]
            if size < MIN_SIZE or bounds[0] < W * 0.05 or bounds[2] > W * 0.95 or bounds[1] < H * 0.05 or bounds[3] > H * 0.95:
                raise ValueError("Thumbnail text fails phone-size or safe-area check")
            contrast = 1.05 / (((0.2 + 0.055) / 1.055) ** 2.4 + 0.05)
            if contrast < 4.5:
                raise ValueError("Thumbnail text contrast is too low")
            return {"size": size, "bounds": bounds, "lines": lines, "placements": placements, "contrast": round(contrast, 2)}
    raise ValueError("Thumbnail title cannot fit at mobile-readable size")


def render(source, output, title, lang):
    plan = layout(title, lang)
    image = Image.open(source).convert("RGB")
    image = image.resize((W, H), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(24))
    image = ImageEnhance.Brightness(image).enhance(0.2)
    draw = ImageDraw.Draw(image)
    font = font_for(lang, plan["size"])
    for line, x, y in plan["placements"]:
        draw.text((x, y), line, font=font, fill="white", stroke_width=2, stroke_fill="#071321")
    image.save(output, "PNG")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", required=True)
    parser.add_argument("--lang", required=True)
    parser.add_argument("--source")
    parser.add_argument("--out")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        plan = layout(args.title, args.lang)
        print(json.dumps({key: plan[key] for key in ("size", "bounds", "lines", "contrast")}))
    else:
        if not args.source or not args.out:
            parser.error("--source and --out are required")
        render(args.source, args.out, args.title, args.lang)
