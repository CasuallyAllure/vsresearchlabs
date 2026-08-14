# Vial art rename brief — hand-off to the image agent (Runware)

You are regenerating product photography for VS Research Labs. Seven compounds were
renamed in the live catalog on 2026-08-11; their label art still prints the old
substance names. Your job is to reprint the label text and nothing else.

Repo: `~/Documents/GitHub/vsresearchlabs`
Generator: **Runware AI** — image-to-image, using the existing file as the reference
image. Do not text-to-image these from scratch; the vial body, cap, lighting,
background and camera angle must stay identical to what is shipping today.

---

## The renames

| Old label text | New label text |
| --- | --- |
| Retatrutide | RTT |
| Semaglutide | SEM |
| Tirzepatide | TZP |
| Cagrilintide | CGL |
| Cagrilintide + Semaglutide (label reads "CagriSema") | CGS |
| Mazdutide | MZD |
| Survodutide | SVD |

Nothing else on the label changes. Keep the V mark, "RESEARCH LABS", the
`PURITY: 99.9%` line, `RESEARCH USE ONLY / NOT FOR HUMAN USE`, and the grey footer
band exactly as they are.

---

## Files to regenerate — 15 total

Filenames are referenced from code. **Keep every path and filename exactly as-is** —
renaming a file breaks the catalog. Overwrite in place, same format (WebP), same
dimensions.

### Register A — hero vial, 7 files

Single vial, dead-centre, light grey seamless studio background, soft top-left key,
graphite/silver crimp cap, clear glass, white wraparound label. Label text is
mono-spaced.

| File | Dimensions | Label must read |
| --- | --- | --- |
| `public/vials/retatrutide-5mg.webp` | 1024×1024 | RTT |
| `public/vials/semaglutide-5mg.webp` | 1024×1024 | SEM |
| `public/vials/tirzepatide-10mg.webp` | 1024×1024 | TZP |
| `public/vials/cagrilintide.webp` | 1000×1000 | CGL |
| `public/vials/cagrisema.webp` | 1000×1000 | CGS |
| `public/vials/mazdutide.webp` | 1000×1000 | MZD |
| `public/vials/survodutide.webp` | 1000×1000 | SVD |

### Register B — wholesale case pack, 7 files

Ten vials in a clear acrylic tray, three-quarter view, same grey studio background
and lighting as Register A. Several labels are legible in frame — every legible one
must show the new code. All ten vials are the same compound.

| File | Dimensions | Label must read |
| --- | --- | --- |
| `public/vials/packs/retatrutide-5mg.webp` | 1000×1000 | RTT |
| `public/vials/packs/semaglutide-5mg.webp` | 1000×1000 | SEM |
| `public/vials/packs/tirzepatide-10mg.webp` | 1000×1000 | TZP |
| `public/vials/packs/cagrilintide.webp` | 1000×1000 | CGL |
| `public/vials/packs/cagrisema.webp` | 1000×1000 | CGS |
| `public/vials/packs/mazdutide.webp` | 1000×1000 | MZD |
| `public/vials/packs/survodutide.webp` | 1000×1000 | SVD |

### Register C — bundle pair, 1 file

`public/vials/reta-ghk-pair.webp` — 1400×1400.

Completely different register from A and B: dark editorial scene, amber glass, blue
GHK-Cu powder, blue-to-gold gradient light, floating glass panels behind. Two vials.
The **left** vial reads "Retatrutide" → change to **RTT**. The **right** vial reads
"GHK-Cu" → leave it alone, that product was not renamed. Preserve the dark scene
exactly; do not lighten it toward the Register A background.

---

## Explicitly NOT your job

- `public/specimens/*.svg` — these are procedurally generated vector plates, not
  photography. They are regenerated from the repo's own renderer. Do not send them
  through Runware.
- `public/specimens/bacteriostatic-water-30ml.svg` — same; the "Research Diluent
  Solution" rename is handled by the SVG renderer.
- Any vial whose compound was not renamed (GHK-Cu, BPC-157, TB-500, everything else
  in `public/vials/`).

---

## Acceptance checks before you hand back

1. Open every regenerated file and **read the label**. Generated label text is the
   single highest-risk failure here — models routinely produce plausible-looking
   garbled text (the current pack render already has partly-melted lettering on the
   rear vials). If a code is misspelled, re-roll it.
2. No old substance name is legible anywhere in frame, including partly-occluded
   rear vials in the pack shots.
3. Dimensions and filenames unchanged; format still WebP; file size in the same
   ballpark as the original (14–50 KB) — do not ship 2 MB PNGs renamed to `.webp`.
4. Register C still reads as the dark editorial scene, and its right-hand vial still
   says GHK-Cu.
5. Put them on a branch and open a PR — do not push straight to `main`. Frontend
   deploys automatically from `main` on push.
