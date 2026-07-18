# NIIMBOT M2 label — landscape adaptation

How the portrait vial lockup became a 40 x 20 mm landscape label, and why each
call was made. The generator is `scripts/labels/build_label.py`; the batch
runner is `scripts/labels/build_library.py`.

## Output contract

| Property | Value |
|---|---|
| Dimensions | exactly 472 x 236 px |
| Physical size | 40.0 x 20.0 mm at 300 dpi |
| Metadata | 300 dpi written into every PNG |
| Colour | pure `#FFFFFF` background, pure `#000000` artwork, nothing between |
| Safe margin | 15 px (~1.27 mm) on all four edges |
| Anti-aliasing | none — rendered at 4x then thresholded to hard edges |

## Source of truth

Every design value is inherited from `scripts/vials/build_vial.py`, the
generator behind `public/vials/*.webp`. Nothing was traced from a photograph.
The original base plate (`VILERAW/IMG_2418.PNG`) is gone from disk and was not
needed; the label is rebuilt as clean vector-quality artwork.

Product names and doses are read from `src/data/biopeptideCompounds.generated.json`
and `src/data/products.json` and compared programmatically against what the
renderer actually drew. No string is typed by hand anywhere in the pipeline.

## The core problem

The vial lockup is a single centred portrait column: mark, wordmark, compound,
dose stacked vertically, with the purity/warning block and bar below. Dropped
into a 2:1 landscape that column would occupy the middle third and leave both
sides empty, and every element would have to shrink to fit 236 px of height.

## Adaptation decisions

**1. The centred column splits into two columns.** The mark moves to its own
left column, vertically centred. The wordmark, compound name and dose stay
stacked and centred as a group in the right-hand type column. This preserves
the vertical reading order of the original while using the full width.

**2. The mark is held at 96 px.** This is the load-bearing constraint. The
mark's ring is a 6 px stroke on a 419 px source; below roughly 70 px tall the
ring falls under one output pixel and disappears entirely when thresholded to
1-bit. At 96 px the ring lands at ~1.4 px and survives. The mark therefore sets
the label's vertical budget rather than being fitted into leftover space.

**3. Mark ink is taken from luminance, not alpha.** The source mark's orbital
ellipses are fully opaque but very light grey. Using the alpha channel (as the
vial generator does, correctly, for a greyscale render) would promote them to
solid black on a 1-bit label. Reading luminance over white lets them fall out
and leaves the solid V, its dot, the helix and the ring.

**4. The wordmark grows from 21 px to 26 px.** The 21 px figure was relative to
a ~340 px-wide label region on the vial render; this label is 472 px wide, so
21 px is proportionally smaller here than it was there. At 21 px Cormorant's
hairline crossbars fall below the ink threshold and the E, A and H strokes break
up. 26 px reproduces cleanly. Tracking stays at 3.0 and the variation weight
stays at 600.

**5. Everything else keeps its spec value.** Compound name in IBM Plex Mono
Medium, auto-fit 26 to 13 px, at most two lines, tracking 1.0, centred. Dose at
0.62x the compound size, tracking 2.4. Purity and warning auto-fit 15 to 9 px,
tracking 0.3, left-aligned — the one left-aligned block in the design, as in the
original.

**6. The compound name auto-fit also respects height.** The original only fit to
width. Here a two-line name has to fit the type column's height as well, so the
fitter shrinks until both constraints hold. Long blends land around 17-20 px;
single-word names print at the full 26 px.

**7. The bottom bar is inset to the safe margin.** On the vial it runs nearly
edge to edge. Thermal printers cannot bleed reliably and the M2's feed drifts
slightly label to label, so the bar spans 15 px to 457 px and sits 15 px off the
bottom edge. Height is 20 px.

**8. Glyphs are snapped to the output pixel grid.** Drawing at fractional
positions made hairlines survive or erode depending on where a given label's
stack happened to land — the wordmark's H crossbar vanished on some labels and
not others. Snapping every glyph origin to a whole output pixel makes a given
glyph rasterise identically across the entire library. All 134 wordmarks are now
byte-identical.

## The gold bar: three files per label

A single-ribbon thermal printer prints all artwork in whatever ribbon is loaded,
so black artwork plus a gold bar in one pass is physically impossible. Each
label ships as three files on one shared canvas:

| File | Contents | Use |
|---|---|---|
| `<slug>_master.png` | everything | canonical master; prints entirely gold on a gold ribbon |
| `<slug>_body.png` | everything except the bar | pass 1, black ribbon |
| `<slug>_bar.png` | the bar only | pass 2, gold ribbon |

All three are 472 x 236 with identical geometry, so feeding the same label
through twice registers exactly. This is asserted, not assumed: validation checks
that `master` equals `body` plus `bar` pixel for pixel, and that `body` and `bar`
share no ink.

## Deliberately absent

The design carries no lot/batch number, no expiry date, no QR code, no barcode
and no hazard or storage icons. None were invented. See the "Flagged for review"
section of `Product Labels/VALIDATION_REPORT.md` for where each could fit if
wanted — and for why a scannable QR or barcode does not fit at this size without
sacrificing the mark.
