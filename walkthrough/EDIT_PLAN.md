# Walkthrough → Ad: edit plan

Raw footage: `walkthrough/video/vsrl-walkthrough.webm` (~50s, 1280×800, recorded
from the live site with a simulated cursor + click ripples). Re-record anytime:

```bash
npm run walkthrough                                   # live site (default)
BASE_URL=http://localhost:5173 npm run walkthrough    # local dev (run `npm run dev` first)
```

The raw clip is *footage*, not a finished ad. To get the polished look (zoom on
clicks, captions, music) do the 20% of post in an editor.

## Fastest path to "ad" polish
- **Screen Studio** (mac) or **CapCut / Descript** — import the `.webm`, turn on
  auto-zoom/cursor smoothing, add the captions below + a track. 30–45 min.

## Scene plan (matches the recording order)

| # | Scene | ~Time | On-screen caption | Polish note |
|---|---|---|---|---|
| 1 | Landing hero + live 3D molecule | 0:00–0:10 | "Real molecular structures. Not stock art." | Slow zoom into the rotating hologram; hold on the headline. |
| 2 | Scroll through landing sections | 0:10–0:18 | "Bay Area biopeptide sciences — highest purity, on demand." | Keep motion smooth; let one section breathe. |
| 3 | Catalog grid | 0:18–0:30 | "A full research catalog, specimen-plated." | Punch-in on a couple of cards as the cursor passes. |
| 4 | (optional) Compound intelligence overlay | 0:30–0:40 | "Tap any compound — structure, specs, sources." | Add once we wire the card-click (see TODO). |
| 5 | Track order page | 0:40–0:48 | "Order tracking + branded invoices, built in." | End card. |
| — | End card | 0:48–0:52 | Logo + "vsresearchlabs.com" + "For Research Use Only." | Static brand outro. |

## Music / tone
- Calm, clinical-but-premium (ambient/electronic, low percussion). Nothing hype.
- Matches the cream-editorial brand — restrained, confident.

## TODO to make it richer (ask me)
- **Scene 4 (overlay):** catalog cards open the Compound Intelligence overlay (not
  a `/product/` route), so the recorder doesn't capture it yet. I can add a
  card-click once we confirm the selector — it's the most impressive shot.
- **Admin flow cut:** a second clip showing the order module (invoice → paid →
  shipped → delivered) — needs a test admin login wired into the recorder.
- **Format:** `.webm` plays in browsers/most editors; an `.mp4` sits alongside if
  ffmpeg was available at record time.
