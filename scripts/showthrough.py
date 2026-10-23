"""Remove stamp show-through from notebook page images.

Rubber-stamp ink on the back of a sheet soaks into the paper and shows as a
faint mirrored ghost on the front. Both sides of every sheet are scanned, so
the back is mirrored, lined up with the front, and the ghost it casts is
divided out: the front is brightened exactly where, and exactly as much as,
the back's ink darkened it. A sketch under a ghost line keeps its shading;
only the ghost's share is removed. Pencil doesn't soak through.

    python scripts/showthrough.py <notebook-id> [position ...]

Writes scans/<id>/NN.clean.jpg for each sheet touching the given page
positions (default: every page), and removes a stale one when a side can't be
cleaned. A sheet is cleaned only when lining up each side against the other
clearly explains the ghosts on both sides at once.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage, signal

BACK_INK = 0.35       # back pixels this much darker than paper are ink
BLURS = (0.5, 1.0, 1.5, 2.0, 3.0)  # ghost softness to try, in px
REGION = 40           # px scale over which ghost strength may vary
EDGE = 0.07           # share of each page edge ignored when lining up
SEARCH_X, SEARCH_Y = 15, 15  # quarter-size px searched around where the sheet's sides line up
MIN_LEAD = 1.15       # how much the chosen shift must beat any other
QUALITY = 80


def back_of(i):
    """Position of the other side of a page's sheet. A right page (odd
    position) backs onto the next left page; the inside cover has no back."""
    if i == 0:
        return None
    return i + 1 if i % 2 else i - 1


def load(path):
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255


def paper(g, size=9, sigma=25):
    """Paper brightness around each pixel: ink removed, then smoothed."""
    return ndimage.gaussian_filter(ndimage.maximum_filter(g, size), sigma)


def relative(g, **kw):
    """Brightness relative to the surrounding paper: 1 is paper."""
    return np.clip(g / np.maximum(paper(g, **kw), 1e-3), 0, 1)


def shrink(g, f):
    h, w = g.shape
    return np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((w // f, h // f), Image.BILINEAR),
                      dtype=np.float32) / 255


def ink_maps(front_g, back_g):
    """Faint marks on the front (excluding the soft edges of its own dark
    lines) and dark ink on the mirrored back."""
    sigma = 0.008 * front_g.shape[1]  # fine scale: follows ink, not page shading
    fr, br = relative(front_g, size=5, sigma=sigma), relative(back_g[:, ::-1], size=5, sigma=sigma)
    near_dark = ndimage.maximum_filter(fr < 0.75, 3)
    d = 1 - fr
    faint = np.where(~near_dark & (d > 0.02) & (d < 0.25), d, 0)
    # The fold's shadow and the page edges make long faint bands that match
    # straight stamp borders anywhere; ghosts are never there.
    h, w = faint.shape
    my, mx = int(h * EDGE), int(w * EDGE)
    faint[:my], faint[h - my:], faint[:, :mx], faint[:, w - mx:] = 0, 0, 0, 0
    ink = np.where(1 - br > BACK_INK, 1 - br, 0)
    return faint, ink


def correlate(faint, ink):
    """Overlap of the front's faint marks with the back's ink at every shift,
    divided by how much of the back's ink lands on the page at that shift, so
    shifts that merely overlap more ink aren't favored."""
    hit = signal.fftconvolve(faint, ink[::-1, ::-1], mode="full")
    landed = signal.fftconvolve(np.ones_like(faint), (ink ** 2)[::-1, ::-1], mode="full")
    score = hit / np.sqrt(np.maximum(landed, 1e-6))
    # A shift that puts most of the back off the page can't be judged.
    return np.where(landed >= 0.5 * (ink ** 2).sum(), score, -np.inf)


def ink_amount(g):
    """How much dark ink a page has, as a weight for its ghosts."""
    _, ink = ink_maps(shrink(g, 4), shrink(g, 4))
    return float(np.sqrt((ink ** 2).sum()))


def search(ga, gb):
    """Score every shift of b's mirrored ink onto a, at quarter size."""
    f, b = ink_maps(shrink(ga, 4), shrink(gb, 4))
    if not b.any():
        return None
    c = correlate(f, b)
    oy, ox = b.shape[0] - 1, b.shape[1] - 1
    return c[oy - SEARCH_Y:oy + SEARCH_Y + 1, ox - SEARCH_X - 60:ox + SEARCH_X + 61]


def refine(ga, gb, dx, dy):
    """The best full-size shift within a few px of (dx, dy)."""
    f, b = ink_maps(ga, gb)
    best = (-1, dx, dy)
    for ddy in range(dy - 6, dy + 7):
        for ddx in range(dx - 6, dx + 7):
            fy, fx, by, bx = max(ddy, 0), max(ddx, 0), max(-ddy, 0), max(-ddx, 0)
            h = min(f.shape[0] - fy, b.shape[0] - by)
            w = min(f.shape[1] - fx, b.shape[1] - bx)
            s = (f[fy:fy + h, fx:fx + w] * b[by:by + h, bx:bx + w]).sum()
            if s > best[0]:
                best = (s, ddx, ddy)
    return best[1], best[2]


def align_sheet(ga, gb):
    """Shifts placing each side's mirrored ink on the other, or None.

    Mirrored, a shift (dx, dy) of b onto a implies (wb - wa + dx, -dy) for a
    onto b, so each candidate is scored by both sides' ghosts together. It's
    trusted when it clearly beats every candidate that isn't nearby."""
    sab, sba = search(ga, gb), search(gb, ga)
    if sab is None and sba is None:
        return None
    # A blank back casts no ghost; that side's scores then count for nothing.
    sab = np.zeros_like(sba) if sab is None else sab
    sba = np.zeros_like(sab) if sba is None else sba
    # With no scanner shift, a wider back lines up offset by the width
    # difference and a narrower one lines up at dx = 0.
    wq = shrink(gb, 4).shape[1] - shrink(ga, 4).shape[1]
    x0 = -max(wq, 0)
    # Each side counts by how much ink its back has; a blank back adds nothing.
    wab, wba = ink_amount(gb), ink_amount(ga)
    scores = np.full((2 * SEARCH_Y + 1, 2 * SEARCH_X + 1), -np.inf)
    for dy in range(-SEARCH_Y, SEARCH_Y + 1):
        for i, dx in enumerate(range(x0 - SEARCH_X, x0 + SEARCH_X + 1)):
            ex = wq + dx
            scores[dy + SEARCH_Y, i] = (wab * sab[dy + SEARCH_Y, dx + SEARCH_X + 60]
                                        + wba * sba[-dy + SEARCH_Y, ex + SEARCH_X + 60])
    y, x = np.unravel_index(np.argmax(scores), scores.shape)
    top = scores[y, x]
    away = scores.copy()
    away[max(y - 3, 0):y + 4, max(x - 3, 0):x + 4] = -np.inf
    if not np.isfinite(top) or top < MIN_LEAD * away.max():
        return None
    dx, dy = (x0 - SEARCH_X + x) * 4, (y - SEARCH_Y) * 4
    ab = refine(ga, gb, dx, dy)
    ba = refine(gb, ga, gb.shape[1] - ga.shape[1] + dx, -dy)
    return ab, ba


def place(back_g, dx, dy, shape):
    """The mirrored back's ink darkness, positioned in front-page coordinates."""
    ink = 1 - relative(back_g[:, ::-1])
    ink = np.where(ink > BACK_INK, ink, 0)
    out = np.zeros(shape, np.float32)
    h, w = ink.shape
    ys, xs = slice(max(dy, 0), min(dy + h, shape[0])), slice(max(dx, 0), min(dx + w, shape[1]))
    out[ys, xs] = ink[ys.start - dy:ys.stop - dy, xs.start - dx:xs.stop - dx]
    return out


def ghost_model(front_g, back_ink):
    """Fit how strongly and how softly the back's ink shows through.
    Measured only on blank paper; returns (softened ink, local strength)."""
    fr = relative(front_g)
    d = 1 - fr
    blank = (fr > 0.75) & ~ndimage.maximum_filter(fr < 0.75, 7)
    best = None
    for sigma in BLURS:
        b = ndimage.gaussian_filter(back_ink, sigma)
        num = ndimage.gaussian_filter(d * b * blank, REGION)
        den = ndimage.gaussian_filter(b * b * blank, REGION)
        k = np.clip(num / np.maximum(den, 1e-6), 0, 0.9)
        k = np.where(den > 1e-4, k, 0)
        resid = ((d - k * b) ** 2 * blank * (b > 0.05)).sum()
        if best is None or resid < best[0]:
            best = (resid, b, k)
    return best[1], best[2]


def clean(front, back_g, dx, dy):
    """The front with the back's ghost divided out, never brighter than paper."""
    g = front.mean(axis=2)
    b, k = ghost_model(g, place(back_g, dx, dy, g.shape))
    gain = 1 / np.maximum(1 - k * b, 0.1)
    plain = np.stack([paper(front[..., c]) for c in range(3)], -1)
    return np.minimum(front * gain[..., None], np.maximum(front, plain))


def clean_sheet(a, b):
    """Both sides of a sheet cleaned, or (None, None) when the alignment isn't
    the same both ways."""
    ga, gb = a.mean(axis=2), b.mean(axis=2)
    shifts = align_sheet(ga, gb)
    if shifts is None:
        return None, None
    ab, ba = shifts
    return clean(a, gb, *ab), clean(b, ga, *ba)


def save(arr, path):
    Image.fromarray((np.clip(arr, 0, 1) * 255).round().astype(np.uint8)).save(path, quality=QUALITY, optimize=True)


def clean_pages(scans, positions):
    image = lambda i: scans / f"{i + 1:02d}.jpg"
    sheets = {tuple(sorted((i, back_of(i)))) for i in positions if back_of(i) is not None}
    cleaned = []
    for a, b in sorted(sheets):
        if not (image(a).exists() and image(b).exists()):
            continue
        results = clean_sheet(load(image(a)), load(image(b)))
        for i, result in zip((a, b), results):
            out = image(i).with_suffix(".clean.jpg")
            if result is None:
                out.unlink(missing_ok=True)
            else:
                save(result, out)
                cleaned.append(i)
    return cleaned


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    scans = Path("scans") / sys.argv[1]
    count = len([p for p in scans.glob("[0-9][0-9].jpg")])
    positions = [int(p) for p in sys.argv[2:]] or list(range(count))
    cleaned = clean_pages(scans, positions)
    print(f"Cleaned {len(cleaned)} pages in {scans}/: {', '.join(str(i + 1) for i in sorted(cleaned)) or 'none'}")
