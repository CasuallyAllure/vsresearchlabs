"""NIIMBOT M2 label generator — VS Research Labs vial labels.

Emits three 472x236 @300dpi PNGs per (product, dose):
  <slug>_master.png  full label, all artwork black
  <slug>_body.png    everything except the bottom bar   (pass 1, black ribbon)
  <slug>_bar.png     the bottom bar only                (pass 2, gold ribbon)

All three share one canvas and one coordinate system, so a two-pass print
registers exactly.

Design spec is inherited verbatim from scripts/vials/build_vial.py (the
generator that produced public/vials/*.webp): Cormorant Garamond weight 600
wordmark with 3.0 tracking, IBM Plex Mono Medium compound code auto-fit to at
most two lines with 1.0 tracking, dose at 0.62x the code size with 2.4
tracking, and a left-aligned purity/warning block with 0.3 tracking. The
portrait lockup is re-composed for the 2:1 landscape target; see
docs/LABEL_LANDSCAPE_ADAPTATION.md (or the Notes/ folder of any product).

Usage:
    scripts/labels/.venv/bin/python scripts/labels/build_label.py \
        --name "Retatrutide" --dose "10mg" --out "some/dir"

    scripts/labels/.venv/bin/python scripts/labels/build_label.py --all
"""

from __future__ import annotations

import argparse
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FONT_DIR = ROOT / ".assets" / "fonts"
MARK_PATH = ROOT / "scripts" / "vials" / "markv.png"

# ---- output contract -------------------------------------------------------
WIDTH, HEIGHT = 472, 236          # 40 x 20 mm at 300 dpi
DPI = 300
SS = 4                            # supersample factor before threshold
MARGIN = 15                       # ~1.27 mm safe margin on every edge
INK_THRESHOLD = 105               # >= this much coverage becomes pure black

# ---- lockup geometry (final px) -------------------------------------------
# Landscape adaptation: the portrait lockup's single centred column is split
# into a left mark column and a right type column. The mark is held at 96 px so
# its ring stroke stays above one pixel after thresholding; below ~70 px the
# ring is sub-pixel and drops out entirely on a 1-bit thermal render.
BAR_HEIGHT = 20
BAR_GAP = 10                      # gap between warning block and bar
MARK_HEIGHT = 96
MARK_COLUMN_GAP = 14              # gap between mark column and type column
MARK_INK_THRESHOLD = 110          # lower than body text so the thin ring survives
WORDMARK_TO_CODE_GAP = 8
CODE_TO_DOSE_GAP = 4
LOCKUP_TO_LEGAL_GAP = 12

WORDMARK = "RESEARCH LABS"
WORDMARK_SIZE = 26
WORDMARK_TRACKING = 3.0
WORDMARK_WEIGHT = 600

CODE_TRACKING = 1.0
CODE_SIZE_MAX, CODE_SIZE_MIN = 26, 13
DOSE_RATIO = 0.62
DOSE_TRACKING = 2.4

PURITY_LINE = "PURITY: 99.9%"
WARNING_LINE = "RESEARCH USE ONLY / NOT FOR HUMAN USE"
LEGAL_TRACKING = 0.3
LEGAL_SIZE_MAX, LEGAL_SIZE_MIN = 15, 9
LEGAL_LINE_GAP = 4


@dataclass(frozen=True)
class Label:
    """One physical vial label: a product name and the dose on that vial."""

    name: str
    dose: str
    slug: str


# ---- fonts -----------------------------------------------------------------


def cormorant(size: int, weight: int = WORDMARK_WEIGHT) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(FONT_DIR / "CormorantGaramond.ttf"), size)
    try:
        font.set_variation_by_axes([weight])
    except Exception:
        pass
    return font


def mono(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / "IBMPlexMono-Medium.ttf"), size)


def line_height(font: ImageFont.FreeTypeFont) -> int:
    ascent, descent = font.getmetrics()
    return ascent + descent


# Characters absent from IBM Plex Mono / Cormorant Garamond, mapped to the
# accepted ASCII spelling of the compound. Without this the label prints a
# .notdef tofu box. Any substitution is reported, never silent.
GLYPH_SUBSTITUTIONS = {"α": "Alpha", "β": "Beta", "γ": "Gamma", "μ": "u"}


NOTDEF_PROBE = "\ue000"  # private-use codepoint: guaranteed absent from any font


def _render_probe(char: str, font: ImageFont.FreeTypeFont) -> bytes:
    box = Image.new("L", (font.size * 3, font.size * 3), 0)
    ImageDraw.Draw(box).text((font.size, font.size), char, font=font, fill=255)
    return box.tobytes()


def _missing_glyphs(text: str, font: ImageFont.FreeTypeFont) -> list[str]:
    """Characters `font` cannot render, detected against its .notdef box."""
    notdef = _render_probe(NOTDEF_PROBE, font)
    return sorted(
        {ch for ch in text if not ch.isspace() and _render_probe(ch, font) == notdef}
    )


def printable_name(name: str) -> tuple[str, list[str]]:
    """The name as it will print, plus a note for every substitution applied."""
    notes: list[str] = []
    out = name
    probe = mono(64)
    for char in _missing_glyphs(name, probe):
        if char not in GLYPH_SUBSTITUTIONS:
            raise ValueError(
                f"{name!r}: character {char!r} (U+{ord(char):04X}) is missing from "
                "IBM Plex Mono and has no approved substitution. Add one to "
                "GLYPH_SUBSTITUTIONS or correct the product name."
            )
        replacement = GLYPH_SUBSTITUTIONS[char]
        out = out.replace(char, replacement)
        notes.append(f"{char!r} (U+{ord(char):04X}) printed as {replacement!r}")
    return out, notes


# ---- tracked text ----------------------------------------------------------


def tracked_width(draw: ImageDraw.ImageDraw, text: str, font, tracking: float) -> float:
    """Width of `text` with `tracking` px inserted after every glyph but the last."""
    if not text:
        return 0.0
    return sum(draw.textlength(ch, font=font) + tracking for ch in text) - tracking


def snap(value: float) -> int:
    """Round to the output pixel grid.

    Every glyph is drawn on a whole output pixel. Left to fractional positions,
    a hairline stroke lands at a different subpixel offset on each label and the
    threshold keeps it or drops it by luck — which showed up as the wordmark's
    H crossbar vanishing on some labels and not others. Snapping makes a given
    glyph rasterise identically everywhere in the library.
    """
    return round(value / SS) * SS


def draw_tracked(draw: ImageDraw.ImageDraw, xy, text: str, font, tracking: float) -> None:
    x, y = xy
    y = snap(y)
    for ch in text:
        draw.text((snap(x), y), ch, font=font, fill=255)
        x += draw.textlength(ch, font=font) + tracking


def wrap_tracked(
    draw: ImageDraw.ImageDraw, text: str, font, max_width: float, tracking: float
) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if tracked_width(draw, candidate, font, tracking) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


# ---- layout ----------------------------------------------------------------


def _fit_legal_font(draw: ImageDraw.ImageDraw, max_width: float):
    """Largest legal-block size (measured in supersampled px) that fits the width."""
    for size in range(LEGAL_SIZE_MAX, LEGAL_SIZE_MIN - 1, -1):
        font = mono(size * SS)
        if tracked_width(draw, WARNING_LINE, font, LEGAL_TRACKING * SS) <= max_width:
            return font
    return mono(LEGAL_SIZE_MIN * SS)


def _fit_code(draw: ImageDraw.ImageDraw, code: str, max_width: float, max_height: float):
    """Largest mono size where the code fits <=2 lines AND the type column fits."""

    def stack(font, lines: list[str], dose_size: int) -> float:
        return (
            line_height(cormorant(WORDMARK_SIZE * SS))
            + WORDMARK_TO_CODE_GAP * SS
            + line_height(font) * len(lines)
            + CODE_TO_DOSE_GAP * SS
            + line_height(mono(dose_size * SS))
        )

    for size in range(CODE_SIZE_MAX, CODE_SIZE_MIN - 1, -1):
        font = mono(size * SS)
        lines = wrap_tracked(draw, code, font, max_width, CODE_TRACKING * SS)
        if len(lines) > 2:
            continue
        if any(tracked_width(draw, ln, font, CODE_TRACKING * SS) > max_width for ln in lines):
            continue
        dose_size = max(11, int(round(size * DOSE_RATIO)))
        total = stack(font, lines, dose_size)
        if total <= max_height:
            return font, lines, dose_size, total

    font = mono(CODE_SIZE_MIN * SS)
    lines = wrap_tracked(draw, code, font, max_width, CODE_TRACKING * SS)[:2]
    dose_size = max(11, int(round(CODE_SIZE_MIN * DOSE_RATIO)))
    return font, lines, dose_size, stack(font, lines, dose_size)


def _load_mark(height: int) -> Image.Image:
    """The V mark as a hard 1-bit ink mask, upscaled to the supersampled canvas.

    Ink is taken from luminance over white, not from alpha: the mark's faint
    grey orbital ellipses are fully opaque but only lightly inked, and on a
    1-bit thermal label they must drop out rather than turn to mush. The mask is
    thresholded at final size and then scaled up with NEAREST so the canvas-wide
    downsample reproduces it unchanged.
    """
    mark = Image.open(MARK_PATH).convert("RGBA")
    flat = Image.new("RGB", mark.size, "white")
    flat.paste(mark, mask=mark.split()[3])
    width = max(1, round(mark.width * height / mark.height))
    ink = 255 - np.asarray(flat.convert("L").resize((width, height), Image.LANCZOS))
    binary = np.where(ink >= MARK_INK_THRESHOLD, 255, 0).astype(np.uint8)
    return Image.fromarray(binary, "L").resize((width * SS, height * SS), Image.NEAREST)


def _render_coverage(label: Label, include_bar: bool, include_body: bool):
    """Draw the label at SS scale onto an 8-bit ink-coverage mask."""
    cov = Image.new("L", (WIDTH * SS, HEIGHT * SS), 0)
    draw = ImageDraw.Draw(cov)

    left = MARGIN * SS
    right = (WIDTH - MARGIN) * SS
    top = MARGIN * SS
    bottom = (HEIGHT - MARGIN) * SS
    content_width = right - left
    centre_x = (left + right) / 2

    drawn: dict[str, object] = {}
    bar_top = bottom - BAR_HEIGHT * SS
    if include_bar:
        draw.rectangle([left, bar_top, right - 1, bottom - 1], fill=255)
    if not include_body:
        return cov, drawn

    # legal block: left-aligned across the full content width, above the bar
    legal_font = _fit_legal_font(draw, content_width)
    legal_h = line_height(legal_font)
    legal_block_h = legal_h * 2 + LEGAL_LINE_GAP * SS
    legal_top = bar_top - BAR_GAP * SS - legal_block_h
    draw_tracked(draw, (left, legal_top), PURITY_LINE, legal_font, LEGAL_TRACKING * SS)
    draw_tracked(
        draw,
        (left, legal_top + legal_h + LEGAL_LINE_GAP * SS),
        WARNING_LINE,
        legal_font,
        LEGAL_TRACKING * SS,
    )

    # upper zone: mark column on the left, type column on the right
    zone_top, zone_bottom = top, legal_top - LOCKUP_TO_LEGAL_GAP * SS
    zone_height = zone_bottom - zone_top

    mark = _load_mark(MARK_HEIGHT)
    cov.paste(
        mark,
        (round(left), round(zone_top + (zone_height - mark.height) / 2)),
        mark,
    )

    col_left = left + mark.width + MARK_COLUMN_GAP * SS
    col_width = right - col_left
    col_centre = (col_left + right) / 2

    code, _ = printable_name(label.name)
    code_font, code_lines, dose_size, stack_h = _fit_code(draw, code, col_width, zone_height)
    y = zone_top + max(0, (zone_height - stack_h) / 2)

    wordmark_font = cormorant(WORDMARK_SIZE * SS)
    wordmark_w = tracked_width(draw, WORDMARK, wordmark_font, WORDMARK_TRACKING * SS)
    draw_tracked(
        draw, (col_centre - wordmark_w / 2, y), WORDMARK, wordmark_font, WORDMARK_TRACKING * SS
    )
    y += line_height(wordmark_font) + WORDMARK_TO_CODE_GAP * SS

    for text in code_lines:
        width = tracked_width(draw, text, code_font, CODE_TRACKING * SS)
        draw_tracked(draw, (col_centre - width / 2, y), text, code_font, CODE_TRACKING * SS)
        y += line_height(code_font)

    y += CODE_TO_DOSE_GAP * SS
    dose_font = mono(dose_size * SS)
    dose_w = tracked_width(draw, label.dose, dose_font, DOSE_TRACKING * SS)
    draw_tracked(draw, (col_centre - dose_w / 2, y), label.dose, dose_font, DOSE_TRACKING * SS)

    drawn.update(
        wordmark=WORDMARK,
        code=" ".join(code_lines),
        code_lines=list(code_lines),
        code_size=code_font.size // SS,
        dose=label.dose,
        purity=PURITY_LINE,
        warning=WARNING_LINE,
    )
    return cov, drawn


def _to_bilevel_png(cov: Image.Image) -> Image.Image:
    """Downsample, then threshold to pure black on pure white — no soft edges."""
    small = cov.resize((WIDTH, HEIGHT), Image.LANCZOS)
    ink = np.asarray(small) >= INK_THRESHOLD
    rgb = np.full((HEIGHT, WIDTH, 3), 255, dtype=np.uint8)
    rgb[ink] = 0
    return Image.fromarray(rgb, "RGB")


def render_label(label: Label, out_dir: Path) -> tuple[dict[str, Path], dict[str, object]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    variants = {
        "master": (True, True),
        "body": (False, True),
        "bar": (True, False),
    }
    written: dict[str, Path] = {}
    drawn: dict[str, object] = {}
    for kind, (bar, body) in variants.items():
        cov, strings = _render_coverage(label, include_bar=bar, include_body=body)
        drawn = drawn or strings
        path = out_dir / f"{label.slug}_{kind}.png"
        _to_bilevel_png(cov).save(path, "PNG", dpi=(DPI, DPI), optimize=True)
        written[kind] = path
    return written, drawn


# ---- product data ----------------------------------------------------------


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("·", "-").replace("+", "plus").replace("α", "alpha")
    text = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()
    return re.sub(r"-{2,}", "-", text)


def load_labels() -> list[tuple[str, Label, str]]:
    """Every (product, dose) pair that has a vial render. Returns (product, label, image)."""
    import json

    data_dir = ROOT / "src" / "data"
    products = json.loads((data_dir / "biopeptideCompounds.generated.json").read_text())
    products += [
        p
        for p in json.loads((data_dir / "products.json").read_text())
        if (p.get("images") or [""])[0].startswith("/vials/")
    ]
    rows: list[tuple[str, Label, str]] = []
    for product in products:
        image = (product.get("images") or [""])[0]
        for variant in product.get("variants") or []:
            dose = variant.get("dose", "")
            rows.append(
                (
                    product["name"],
                    Label(product["name"], dose, f"{slugify(product['name'])}-{slugify(dose)}"),
                    image,
                )
            )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Build NIIMBOT M2 vial labels.")
    parser.add_argument("--name", help="Product name, exactly as printed")
    parser.add_argument("--dose", default="", help='Dose, e.g. "10mg"')
    parser.add_argument("--out", default="out", help="Output directory")
    parser.add_argument("--all", action="store_true", help="Build the full product library")
    args = parser.parse_args()

    if args.all:
        root = ROOT / "Product Labels" / "VS Research Labs"
        rows = load_labels()
        for product_name, label, _ in rows:
            render_label(label, root / product_name / "Master PNG")
        print(f"built {len(rows) * 3} files under {root}")
        return

    if not args.name:
        parser.error("--name is required unless --all is given")
    label = Label(args.name, args.dose, f"{slugify(args.name)}-{slugify(args.dose)}")
    written, drawn = render_label(label, Path(args.out))
    for kind, path in written.items():
        print(f"{kind}: {path}")
    print(f"printed name: {drawn['code']!r}  dose: {drawn['dose']!r}")


if __name__ == "__main__":
    main()
