# NIIMBOT M2 label generator

Produces print-ready 40 x 20 mm (472 x 236 px @ 300 dpi) vial labels for VS
Research Labs. Design decisions and the portrait-to-landscape rationale are in
`docs/LABEL_LANDSCAPE_ADAPTATION.md`.

## Setup

Already done, but to recreate the environment:

```bash
python3 -m venv scripts/labels/.venv
scripts/labels/.venv/bin/pip install Pillow numpy
```

Requires the fonts in `.assets/fonts/` (CormorantGaramond.ttf,
IBMPlexMono-Medium.ttf) and the mark at `scripts/vials/markv.png`.

## One label

```bash
scripts/labels/.venv/bin/python scripts/labels/build_label.py \
    --name "Retatrutide" --dose "10mg" --out "some/output/dir"
```

Writes three PNGs — `_master`, `_body`, `_bar` — and prints the name and dose
exactly as they were rendered, so you can confirm them.

**Adding a new product needs no code change.** Pass any name and dose; the
compound name auto-fits to at most two lines. If a name contains a character the
bundled fonts cannot render, the generator either substitutes an approved ASCII
spelling (and reports it) or fails loudly rather than printing an empty box.

## The whole library

```bash
scripts/labels/.venv/bin/python scripts/labels/build_library.py
```

Reads every vial product and dose from `src/data/`, writes
`Product Labels/VS Research Labs/<Product>/{Master PNG,Source Images,Notes}/`,
validates every file, and writes `Product Labels/VALIDATION_REPORT.md` plus
contact sheets. It is safe to re-run; output is deterministic.

`Product Labels/` and `.venv/` are gitignored — regenerate rather than commit.

## Printing

The M2 has one ribbon, so black artwork and a gold bar cannot print in one pass.

- **Gold ribbon, one pass:** print `_master.png`. The whole label prints gold.
- **Black + gold, two passes:** print `_body.png` on black, reload with gold,
  feed the same label through again and print `_bar.png`.

Print at 100% / actual size with any "fit to label" scaling turned off — the
files already carry the exact pixel dimensions and 300 dpi metadata.
