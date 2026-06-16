# Landing intro videos

These power the 3-slide intro carousel in the first-visit modal
(`src/components/landing/VideoIntroModule.tsx`). Self-hosted, no YouTube/embeds.

## Drop-in convention

Each slide auto-looks for two files **named by the slide id**. Drop both in and
the slide goes live — no code change:

| Slide | id | poster | video |
|---|---|---|---|
| What are biopeptides | `what-are` | `what-are.jpg` | `what-are.mp4` |
| Our research | `why-vsrl` | `why-vsrl.jpg` | `why-vsrl.mp4` |
| For research only | `b2b-only` | `b2b-only.jpg` | `b2b-only.mp4` |

The **poster gates the slide**: if the `.jpg` is here, the slide shows the
poster + a play button and the `.mp4` only downloads when tapped (keeps the
landing light). No poster → the slide shows the DNA "coming soon" plate, so it
never looks broken before the files exist.

## Keep them small (light + crisp on phone)

- **Format:** MP4, H.264 (`yuv420p`), AAC audio. Widely supported, hardware-decoded on phones.
- **Resolution:** 1280×720 (720p) is plenty — go 960×540 if you want even lighter.
- **Aspect:** 16:9 landscape (the well is 16:9; vertical clips get cropped).
- **Bitrate / size:** aim ~1.5–3 Mbps; a 30–60s clip lands ~5–10 MB. Smaller is better.
- **Length:** short. These are intros, not features.
- **Poster:** a single frame as JPG at the same resolution, ~100–200 KB.

### Example encode (ffmpeg)

```bash
# video — 720p, web-optimized, faststart so it streams while loading
ffmpeg -i source.mov -vf "scale=-2:720" -c:v libx264 -profile:v high -pix_fmt yuv420p \
  -crf 24 -preset veryfast -movflags +faststart -c:a aac -b:a 96k what-are.mp4

# poster — grab a frame at 2s
ffmpeg -i what-are.mp4 -ss 00:00:02 -frames:v 1 -q:v 3 what-are.jpg
```

Filenames are case-sensitive on the server — match the ids above exactly.
