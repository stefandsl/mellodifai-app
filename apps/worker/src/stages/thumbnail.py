"""One title focal point over a softened frame from this song's video."""
import argparse
import json
import unicodedata
from functools import lru_cache
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
FALLBACK_FONTS = [
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/meiryob.ttc",
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/malgunbd.ttf",
    "C:/Windows/Fonts/seguiemj.ttf",
]


@lru_cache(maxsize=None)
def font_path(glyph, lang):
    for candidate in FONT_CANDIDATES.get(lang, []) + FALLBACK_FONTS:
        if Path(candidate).exists():
            font = ImageFont.truetype(candidate, MIN_SIZE)
            missing = font.getmask(chr(0x10FFFD))
            if all(
                (mask := font.getmask(char)).size != missing.size
                or bytes(mask) != bytes(missing)
                for char in glyph
            ):
                return candidate
    codes = " ".join(f"U+{ord(char):04X}" for char in glyph)
    raise ValueError(f"No thumbnail font covers {codes}")


@lru_cache(maxsize=None)
def font_for(path, size):
    return ImageFont.truetype(path, size)


def clusters(text):
    result = []
    for char in text:
        code = ord(char)
        attached = (
            unicodedata.combining(char)
            or 0xFE00 <= code <= 0xFE0F
            or 0x1F3FB <= code <= 0x1F3FF
            or char == "\u200d"
            or (result and result[-1].endswith("\u200d"))
        )
        if result and attached:
            result[-1] += char
        else:
            result.append(char)
    return result


def runs(text, lang, size):
    result = []
    for glyph in clusters(text):
        font = font_for(font_path(glyph, lang), size)
        if result and result[-1][1] is font:
            result[-1] = (result[-1][0] + glyph, font)
        else:
            result.append((glyph, font))
    return result


def text_width(text, lang, size, draw):
    return sum(draw.textlength(part, font=font) for part, font in runs(text, lang, size))


def line_box(text, lang, size, draw):
    x = 0
    boxes = []
    for part, font in runs(text, lang, size):
        left, top, right, bottom = draw.textbbox((0, 0), part, font=font, anchor="ls", stroke_width=2)
        boxes.append((x + left, top, x + right, bottom))
        x += draw.textlength(part, font=font)
    return min(box[0] for box in boxes), min(box[1] for box in boxes), max(box[2] for box in boxes), max(box[3] for box in boxes)


def wrap(title, lang, size, draw):
    lines = []
    line = ""
    for word in title.split():
        candidate = f"{line} {word}".strip()
        if text_width(candidate, lang, size, draw) <= W - 2 * MARGIN_X:
            line = candidate
            continue
        if line:
            lines.append(line)
        line = ""
        for glyph in clusters(word):
            if text_width(line + glyph, lang, size, draw) > W - 2 * MARGIN_X:
                if line:
                    lines.append(line)
                line = glyph
            else:
                line += glyph
    if line:
        lines.append(line)
    return lines


def layout(title, lang):
    title = title.strip()
    if not title:
        raise ValueError("Thumbnail title is empty")
    draw = ImageDraw.Draw(Image.new("RGB", (W, H)))
    for size in range(112, MIN_SIZE - 1, -2):
        lines = wrap(title, lang, size, draw)
        spacing = round(size * 0.2)
        boxes = [line_box(line, lang, size, draw) for line in lines]
        height = sum(box[3] - box[1] for box in boxes) + spacing * (len(lines) - 1)
        if height <= H - 2 * MARGIN_Y and all(box[2] - box[0] <= W - 2 * MARGIN_X for box in boxes):
            y = (H - height) // 2
            placements = []
            for line, box in zip(lines, boxes):
                placements.append((line, (W - (box[2] - box[0])) // 2 - box[0], y - box[1]))
                y += box[3] - box[1] + spacing
            bounds = [min(x + box[0] for (_, x, _), box in zip(placements, boxes)), (H - height) // 2,
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
    for line, x, y in plan["placements"]:
        for part, font in runs(line, lang, plan["size"]):
            draw.text((x, y), part, font=font, anchor="ls", fill="white", stroke_width=2, stroke_fill="#071321")
            x += draw.textlength(part, font=font)
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
        result = {key: plan[key] for key in ("size", "bounds", "lines", "contrast")}
        result["fonts"] = sorted(
            {Path(font_path(glyph, args.lang)).name for glyph in clusters(args.title.strip())}
        )
        print(json.dumps(result))
    else:
        if not args.source or not args.out:
            parser.error("--source and --out are required")
        render(args.source, args.out, args.title, args.lang)
