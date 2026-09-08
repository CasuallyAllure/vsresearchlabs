"""Selank nasal spray product shot: flat label art wrapped onto the bottle as a
cylinder — Lambert shading, elliptical bow, edge falloff, contact shadow.
Composited through a sub-pixel alpha mask so every edge stays anti-aliased."""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

ROOT = "/Users/velari/Documents/GitHub/vsresearchlabs"
FDIR = f"{ROOT}/.assets/fonts"
SP = f"{ROOT}/scripts/vials"
WT = f"{ROOT}/.claude/worktrees/unruffled-cartwright-29b085"

PAPER = (250, 250, 248)
INK = (35, 36, 40)
GREY_BAR = (128, 130, 134)

BX0, BX1 = 696, 1094          # bottle body, measured off the render
INSET = 3                      # keep the glass rim highlight alive at the edges
LX0, LX1 = BX0 + INSET, BX1 - INSET
LW = LX1 - LX0
LH = 362
BAR_H = 16
TOP_Y = 1444
SS = 4                         # supersample factor for the flat artwork

BOW = 20                       # px the horizontal edges dip at centre
LIGHT_DEG = -18
EDGE_FLOOR = 0.66
PAD = 40                       # vertical headroom for the bow + shadow


def cormorant(sz, w=600):
    f = ImageFont.truetype(f"{FDIR}/CormorantGaramond.ttf", sz)
    try:
        f.set_variation_by_axes([w])
    except Exception:
        pass
    return f


def mono(sz, semib=False):
    return ImageFont.truetype(f"{FDIR}/IBMPlexMono-{'SemiBold' if semib else 'Medium'}.ttf", sz)


# ── 1. flat label artwork, drawn oversized then downsampled ──────────────────
flat = Image.new("RGB", (LW * SS, LH * SS), PAPER)
d = ImageDraw.Draw(flat)
d.rectangle([0, 0, LW * SS, BAR_H * SS], fill=GREY_BAR)
d.rectangle([0, (LH - BAR_H) * SS, LW * SS, LH * SS], fill=GREY_BAR)

cx = LW * SS // 2


def tw(t, f, tr):
    return sum(d.textlength(c, font=f) + tr for c in t) - tr


def line(t, f, tr, y, color=INK):
    x = cx - tw(t, f, tr) / 2
    for c in t:
        d.text((x, y), c, font=f, fill=color)
        x += d.textlength(c, font=f) + tr


mark = Image.open(f"{SP}/markv.png").convert("RGBA")
mh = 44 * SS
mw = int(mark.width * mh / mark.height)
mark = mark.resize((mw, mh), Image.LANCZOS)

wf = cormorant(20 * SS, 600); wtr = 2.6 * SS
wh = wf.getmetrics()[0] + wf.getmetrics()[1]
nf = mono(40 * SS, semib=True)
nh = nf.getmetrics()[0] + nf.getmetrics()[1]
df = mono(19 * SS)
dh = df.getmetrics()[0] + df.getmetrics()[1]
pf = mono(12 * SS)
ph = pf.getmetrics()[0] + pf.getmetrics()[1]

g1, g2, g3, g4 = 8 * SS, 12 * SS, 10 * SS, 16 * SS
content = mh + g1 + wh + g2 + nh + g3 + dh + g4 + ph
y = BAR_H * SS + ((LH - 2 * BAR_H) * SS - content) // 2

flat.paste(mark, (cx - mw // 2, y), mark)
y += mh + g1
line("RESEARCH LABS", wf, wtr, y)
y += wh + g2
line("Selank", nf, 0.5 * SS, y)
y += nh + g3
line("5mg  ·  10mL", df, 1.2 * SS, y)
y += dh + g4
line("RESEARCH USE ONLY / NOT FOR HUMAN USE", pf, 0.6 * SS, y)

flat = flat.resize((LW, LH), Image.LANCZOS)
flat = flat.filter(ImageFilter.GaussianBlur(0.6))  # photographic edge softness

# ── 2. cylinder model ────────────────────────────────────────────────────────
u = np.clip((np.arange(LW) - (LW - 1) / 2) / ((LW - 1) / 2), -0.9999, 0.9999)
theta = np.arcsin(u)
phi = np.deg2rad(LIGHT_DEG)

lam = np.clip(np.cos(theta - phi), 0, None)
shade = EDGE_FLOOR + (1.0 - EDGE_FLOOR) * lam ** 0.85
shade *= 1.0 + 0.05 * np.exp(-((theta - phi) / 0.30) ** 2)
foreshorten = np.cos(theta)
# the paper turns away from camera at the extreme edges
shade *= 0.88 + 0.12 * np.clip(foreshorten / 0.32, 0, 1)

art = np.asarray(flat).astype(float) * shade[None, :, None]

base = Image.open(f"{WT}/.scratch/spray-blank3.png").convert("RGB")
base_arr = np.asarray(base).astype(float)

# a whisper of the glass's own vertical highlight riding over the paper
glass = base_arr.mean(axis=2)[TOP_Y:TOP_Y + LH, LX0:LX1]
art = art + ((glass - glass.mean()) * 0.10)[:, :, None]
art = np.clip(art, 0, 255)

# ── 3. warp into a padded RGBA strip, then alpha-composite once ──────────────
strip_h = LH + 2 * PAD
rgb = np.zeros((strip_h, LW, 3))
alpha = np.zeros((strip_h, LW))
shadow_a = np.zeros((strip_h, LW))

dy = BOW * np.cos(theta)

for i in range(LW):
    off = PAD + dy[i]
    y0 = int(np.floor(off))
    frac = off - y0

    src = np.zeros((LH + 2, 3))
    src[1:-1] = art[:, i, :]
    a = np.zeros(LH + 2)
    a[1:-1] = 1.0

    col_rgb = src[:-1] * (1 - frac) + src[1:] * frac
    col_a = a[:-1] * (1 - frac) + a[1:] * frac

    n = len(col_a)
    rgb[y0:y0 + n, i, :] = col_rgb
    alpha[y0:y0 + n, i] = col_a

    # paper thickness: contact shadow as a continuous function of the exact
    # (sub-pixel) edge position, so adjacent columns never stair-step
    rows = np.arange(strip_h)
    below = rows - (off + LH)
    above = (off) - rows
    shadow_a[:, i] = (
        0.42 * np.exp(-np.clip(below, 0, None) ** 2 / (2 * 3.2 ** 2)) * (below >= 0)
        + 0.26 * np.exp(-np.clip(above, 0, None) ** 2 / (2 * 2.6 ** 2)) * (above >= 0)
    )

# A linear shift gives a near-horizontal edge only ONE partial pixel of
# coverage, which reads as stair-stepping. Smooth the warped strip along Y only
# (premultiplied rgb + alpha together) so those edges get real anti-aliasing
# without softening any vertical detail in the type.
k = np.array([0.06, 0.24, 0.40, 0.24, 0.06])
def blur_y(a):
    out = np.zeros_like(a)
    for j, w in enumerate(k):
        out += w * np.roll(a, j - 2, axis=0)
    return out

rgb = blur_y(rgb)
alpha = blur_y(alpha)

shadow_a = np.asarray(
    Image.fromarray((np.clip(shadow_a,0,1) * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.2))
).astype(float) / 255.0
shadow_a *= (1 - alpha)        # never darken the label itself

region = base_arr[TOP_Y - PAD:TOP_Y - PAD + strip_h, LX0:LX1, :]
region = region * (1 - shadow_a[:, :, None]) + np.array([60, 60, 62]) * shadow_a[:, :, None]
# `rgb` is already alpha-premultiplied (the strip is padded with zeros), so
# compositing must NOT multiply by alpha again or every edge gains a dark fringe
region = region * (1 - alpha[:, :, None]) + rgb
base_arr[TOP_Y - PAD:TOP_Y - PAD + strip_h, LX0:LX1, :] = region

res = Image.fromarray(np.clip(base_arr, 0, 255).astype("uint8"))

# ── 4. square it up (mirror pad, no streaks) ────────────────────────────────
W, H = res.size
S = H
arr = np.asarray(res)
pl = (S - W) // 2
sq = Image.fromarray(np.pad(arr, ((0, 0), (pl, S - W - pl), (0, 0)), mode="reflect"))
final = sq.resize((1000, 1000), Image.BOX)

dest = f"{WT}/.scratch/selank-spray-v12.png"
final.save(dest)
final.crop((380, 570, 640, 790)).resize((780, 660), Image.LANCZOS).save(f"{WT}/.scratch/zoom12.png")
print("saved", dest, final.size)
