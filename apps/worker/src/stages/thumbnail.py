"""One title focal point over a softened frame from this song's video."""
import argparse
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps, ImageStat

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


# Cover candidates (PIANO-UNIFICATO M2b, Videohub idea 6): three frames of the owner's own render,
# chosen without a model and the same way every time, with the song title as local typography.
# Faces are not measured: no local face detector is installed (PIL only, also on Debian).
COVER_METHOD = "frames-v1"
COVER_SIZES = range(152, 87, -4)  # 88 px at 1280 = 11.5 px at 168 px wide.
COVER_LINES = 3
PHONE = (168, 94)
PHONE_MIN_LINE_PX = 8  # Ink height of the smallest title line at 168x94, measured.
PHONE_MIN_CONTRAST = 4.5
SAFE = 0.05
STATS_SIZE = (160, 90)


def frame_stats(path):
    gray = Image.open(path).convert("L").resize(STATS_SIZE, Image.Resampling.BILINEAR)
    edges = ImageStat.Stat(gray.filter(ImageFilter.FIND_EDGES).crop((1, 1, STATS_SIZE[0] - 1, STATS_SIZE[1] - 1)))
    hist = gray.resize((32, 18), Image.Resampling.BILINEAR).histogram()
    bins = [sum(hist[i:i + 16]) / (32 * 18) for i in range(0, 256, 16)]
    return {"sharpness": round(edges.var[0], 3), "brightness": round(ImageStat.Stat(gray).mean[0], 3), "hist": bins}


def sung_intervals(srt):
    """The sung lines of the render's subtitles: the frames to avoid (lyrics are on screen)."""
    if not srt or not Path(srt).exists():
        return []
    stamp = r"(\d+):(\d\d):(\d\d)[,.](\d{3})"
    seconds = lambda m, i: int(m[i]) * 3600 + int(m[i + 1]) * 60 + int(m[i + 2]) + int(m[i + 3]) / 1000
    result = []
    for match in re.finditer(stamp + r"\s*-->\s*" + stamp, Path(srt).read_text(encoding="utf-8-sig")):
        groups = (None,) + match.groups()
        result.append((seconds(groups, 1), seconds(groups, 5)))
    return result


def choose_frames(frames, step, sung, count=3):
    """frames: sorted file paths, one every `step` seconds from 0. Deterministic: same files, same picks."""
    if not frames:
        raise ValueError("No frames to choose a cover from")
    rows = []
    for index, path in enumerate(frames):
        at = round(index * step, 3)
        stats = frame_stats(path)
        lyric_free = not any(start - 0.25 <= at <= end + 0.25 for start, end in sung)
        rows.append({"path": path, "time": at, "lyric_free": lyric_free, **stats})
    duration = rows[-1]["time"] + step
    eligible = [r for r in rows if duration * 0.05 <= r["time"] <= duration * 0.95 and 20 <= r["brightness"] <= 235]
    if len(eligible) < count:
        eligible = rows
    ranked = sorted(eligible, key=lambda r: (not r["lyric_free"], -r["sharpness"], r["time"]))
    gap = duration * 0.1
    distance = lambda a, b: sum(abs(x - y) for x, y in zip(a["hist"], b["hist"]))
    picked = []
    for strict in (True, False, None):
        for row in ranked:
            if len(picked) == count:
                break
            if any(row is other for other in picked):
                continue
            if strict is not None and any(abs(row["time"] - other["time"]) < gap for other in picked):
                continue
            if strict and any(distance(row, other) < 0.25 for other in picked):
                continue
            row["distinct"] = bool(strict)
            picked.append(row)
    return picked


def cover_fit(text, lang, size, draw):
    width, height = W * (1 - 2 * SAFE) - 2 * 24, H * (1 - 2 * SAFE) - 2 * 24
    lines = wrap(text, lang, size, draw)
    if len(lines) > COVER_LINES:
        return None
    boxes = [line_box(line, lang, size, draw) for line in lines]
    spacing = round(size * 0.18)
    block = sum(b[3] - b[1] for b in boxes) + spacing * (len(lines) - 1)
    if block > height or any(b[2] - b[0] > width for b in boxes):
        return None
    y = (H - block) // 2
    placements = []
    for line, box in zip(lines, boxes):
        placements.append((line, (W - (box[2] - box[0])) // 2 - box[0], y - box[1], box))
        y += box[3] - box[1] + spacing
    return {"size": size, "lines": lines, "placements": placements}


def cover_layout(title, lang, draw):
    """The largest size that fits in at most three lines inside the safe box; a longer title is cut
    with an ellipsis (whole words first) at the smallest readable size, never shrunk below it."""
    text = " ".join(title.split())
    if not text:
        raise ValueError("Thumbnail title is empty")
    for size in COVER_SIZES:
        plan = cover_fit(text, lang, size, draw)
        if plan:
            return {**plan, "cut": False}
    smallest = COVER_SIZES[-1]
    words = text.split(" ")
    cuts = [" ".join(words[:keep]) + "\u2026" for keep in range(len(words) - 1, 0, -1)]
    glyphs = clusters(words[0])
    cuts += ["".join(glyphs[:keep]) + "\u2026" for keep in range(len(glyphs) - 1, 0, -1)]
    for candidate in cuts:
        plan = cover_fit(candidate, lang, smallest, draw)
        if plan:
            return {**plan, "cut": True}
    raise ValueError("Thumbnail title cannot fit at mobile-readable size")


def luminance(value):
    channel = value / 255
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def measure(image, mask, plan, size):
    """Ink height of each title line, the font's em and the text-to-background contrast, in pixels of `size`."""
    small = image.resize(size, Image.Resampling.LANCZOS).convert("L")
    small_mask = mask.resize(size, Image.Resampling.LANCZOS)
    scale = size[0] / W
    heights, bounds = [], [size[0], size[1], 0, 0]
    text_lum, back_lum = [], []
    for _, x, y, box in plan["placements"]:
        left, top = int((x + box[0]) * scale), int((y + box[1]) * scale)
        right, bottom = int((x + box[2]) * scale) + 1, int((y + box[3]) * scale) + 1
        region = small_mask.crop((left, top, right, bottom))
        ink = region.point(lambda v: 255 if v >= 128 else 0).getbbox()
        heights.append(0 if ink is None else ink[3] - ink[1])
        if ink:
            bounds = [min(bounds[0], left + ink[0]), min(bounds[1], top + ink[1]),
                      max(bounds[2], left + ink[2]), max(bounds[3], top + ink[3])]
        pixels = small.crop((left, top, right, bottom)).tobytes()
        for value, alpha in zip(pixels, region.tobytes()):
            (text_lum if alpha >= 200 else back_lum if alpha <= 8 else []).append(luminance(value))
    if not text_lum or not back_lum:
        return {"min_line_px": 0, "em_px": 0, "contrast": 0, "bounds": bounds}
    text = sum(text_lum) / len(text_lum)
    back = sorted(back_lum)[int(len(back_lum) * 0.9) - 1 if len(back_lum) > 1 else 0]
    contrast = (max(text, back) + 0.05) / (min(text, back) + 0.05)
    return {"min_line_px": min(heights), "em_px": round(plan["size"] * scale, 2),
            "contrast": round(contrast, 2), "bounds": bounds}


def render_cover(source, output, title, lang):
    draw = ImageDraw.Draw(Image.new("RGB", (W, H)))
    plan = cover_layout(title, lang, draw)
    frame = ImageOps.fit(Image.open(source).convert("RGB"), (W, H), Image.Resampling.LANCZOS)
    mask = Image.new("L", (W, H), 0)
    mask_draw = ImageDraw.Draw(mask)
    for line, x, y, _ in plan["placements"]:
        for part, font in runs(line, lang, plan["size"]):
            mask_draw.text((x, y), part, font=font, anchor="ls", fill=255)
            x += mask_draw.textlength(part, font=font)
    # Darken the frame only as much as the measured contrast at phone size needs.
    for darkness in (0.7, 0.6, 0.5, 0.4, 0.3, 0.2):
        image = ImageEnhance.Brightness(frame).enhance(darkness)
        cover = image.copy()
        cover_draw = ImageDraw.Draw(cover)
        for line, x, y, _ in plan["placements"]:
            for part, font in runs(line, lang, plan["size"]):
                cover_draw.text((x, y), part, font=font, anchor="ls", fill="white", stroke_width=3, stroke_fill="#071321")
                x += cover_draw.textlength(part, font=font)
        phone = measure(cover, mask, plan, PHONE)
        if phone["contrast"] >= PHONE_MIN_CONTRAST:
            break
    desktop = measure(cover, mask, plan, (W, H))
    box = desktop["bounds"]
    if (phone["min_line_px"] < PHONE_MIN_LINE_PX or phone["contrast"] < PHONE_MIN_CONTRAST
            or box[0] < W * SAFE or box[1] < H * SAFE or box[2] > W * (1 - SAFE) or box[3] > H * (1 - SAFE)):
        raise ValueError("Cover text fails the phone-size or safe-area check")
    cover.save(output, "PNG")
    fonts = sorted({Path(font_path(glyph, lang)).name for line in plan["lines"] for glyph in clusters(line) if glyph.strip()})
    return {"size": plan["size"], "lines": plan["lines"], "cut": plan["cut"], "fonts": fonts,
            "darkness": darkness, "phone": phone, "desktop": desktop}


def make_covers(frames_dir, step, srt, outputs, title, lang):
    frames = sorted(str(p) for p in Path(frames_dir).glob("f*.jpg"))
    picked = choose_frames(frames, step, sung_intervals(srt), len(outputs))
    result = []
    for index, (row, output) in enumerate(zip(picked, outputs), start=1):
        info = render_cover(row["path"], output, title, lang)
        result.append({"id": f"cover-{index}", "file": Path(output).name.replace(".part", ""),
                       "frame": Path(row["path"]).name, "frame_sec": row["time"],
                       "sharpness": row["sharpness"], "lyric_free": row["lyric_free"],
                       "distinct": row["distinct"], **info})
    return {"method": COVER_METHOD, "covers": result}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", required=True)
    parser.add_argument("--lang", required=True)
    parser.add_argument("--source")
    parser.add_argument("--out")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--frames")
    parser.add_argument("--step", type=float, default=2.0)
    parser.add_argument("--srt")
    parser.add_argument("--covers", nargs="+")
    parser.add_argument("--manifest")
    args = parser.parse_args()
    if args.covers:
        if not args.frames:
            parser.error("--frames is required with --covers")
        made = json.dumps(make_covers(args.frames, args.step, args.srt, args.covers, args.title, args.lang), ensure_ascii=False)
        if args.manifest:
            Path(args.manifest).write_text(made, encoding="utf-8")
        print(made)
    elif args.check:
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
