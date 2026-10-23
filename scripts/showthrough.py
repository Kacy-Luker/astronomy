"""Remove stamp show-through from notebook page images.

Rubber-stamp ink on the back of a sheet soaks into the paper and shows as a
faint mirrored ghost on the front; pencil doesn't. Both sides of every sheet
are scanned, so the back is mirrored and best-fit onto the front using its
stamp ink. Inside the ghost's footprint, faint pixels are rebuilt from the
pixels around them, and may only get lighter: on blank paper the ghost turns
to paper, and on a sketch the shading carries straight through. Dark marks on
the front (pencil, print) are never changed.

    python scripts/showthrough.py <notebook-id> [position ...]

Writes scans/<id>/NN.clean.jpg for each sheet touching the given page
positions (default: every page), and removes a stale one when the sheet
can't be cleaned. Pages pair by their printed numbers (odd page N is backed
by page N + 1); unnumbered front matter pairs by position. A sheet is cleaned
only when one alignment clearly explains the ghosts on both sides at once.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage, signal

STAMP_INK = 0.55      # back pixels this much darker than paper are stamp ink (pencil is lighter)
FOOTPRINT_INK = 0.35  # looser, for where ghosts are removed: stamps print unevenly
GROW = 4              # px the footprint is widened by, to cover the ghost's blur
FILL = 4              # px scale of the neighborhood a ghost pixel is rebuilt from
KEEP = 0.6            # front pixels darker than this (relative to paper) are never changed
ANGLES = (-0.5, -0.25, 0.0, 0.25, 0.5)  # degrees the sides may be rotated against each other
EDGE = 0.07           # share of each page edge ignored when lining up
SCALE = 2             # search at half size: thin faint ghost lines vanish at quarter size
SEARCH_X, SEARCH_Y = 120, 60  # px at SCALE searched: scanner placement varies between spreads
PAD_X = 120           # extra px at SCALE for the sheet's width difference
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
    ink = np.where(1 - br > STAMP_INK, 1 - br, 0)
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
    _, ink = ink_maps(shrink(g, SCALE), shrink(g, SCALE))
    return float(np.sqrt((ink ** 2).sum()))


def search(ga, gb):
    """Score every shift of b's mirrored ink onto a, at SCALE size."""
    f, b = ink_maps(shrink(ga, SCALE), shrink(gb, SCALE))
    if not b.any():
        return None
    c = correlate(f, b)
    oy, ox = b.shape[0] - 1, b.shape[1] - 1
    return c[oy - SEARCH_Y:oy + SEARCH_Y + 1, ox - SEARCH_X - PAD_X:ox + SEARCH_X + PAD_X + 1]


def overlap(f, b, dx, dy):
    fy, fx, by, bx = max(dy, 0), max(dx, 0), max(-dy, 0), max(-dx, 0)
    h, w = min(f.shape[0] - fy, b.shape[0] - by), min(f.shape[1] - fx, b.shape[1] - bx)
    return float((f[fy:fy + h, fx:fx + w] * b[by:by + h, bx:bx + w]).sum())


def refine(ga, gb, dx, dy):
    """The best full-size (dx, dy, angle) near (dx, dy): scanned pages can sit
    a little crooked, so small rotations of the back are tried too."""
    f, _ = ink_maps(ga, gb)
    best = (-1, dx, dy, 0.0)
    for angle in ANGLES:
        rotated = gb if angle == 0 else ndimage.rotate(gb, angle, reshape=False, mode="nearest")
        _, b = ink_maps(ga, rotated)
        for ddy in range(dy - 6, dy + 7, 2):
            for ddx in range(dx - 6, dx + 7, 2):
                s = overlap(f, b, ddx, ddy)
                if s > best[0]:
                    best = (s, ddx, ddy, angle)
    _, dx, dy, angle = best
    rotated = gb if angle == 0 else ndimage.rotate(gb, angle, reshape=False, mode="nearest")
    _, b = ink_maps(ga, rotated)
    best = max((overlap(f, b, ddx, ddy), ddx, ddy) for ddy in range(dy - 1, dy + 2) for ddx in range(dx - 1, dx + 2))
    return best[1], best[2], angle


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
    # Centered where the sides would meet if both spreads sat in the same spot
    # on the scanner; the search is wide because they rarely do.
    wq = shrink(gb, SCALE).shape[1] - shrink(ga, SCALE).shape[1]
    x0 = -max(wq, 0)
    # Each side counts by how much ink its back has; a blank back adds nothing.
    wab, wba = ink_amount(gb), ink_amount(ga)
    scores = np.full((2 * SEARCH_Y + 1, 2 * SEARCH_X + 1), -np.inf)
    for dy in range(-SEARCH_Y, SEARCH_Y + 1):
        for i, dx in enumerate(range(x0 - SEARCH_X, x0 + SEARCH_X + 1)):
            ex = wq + dx
            scores[dy + SEARCH_Y, i] = (wab * sab[dy + SEARCH_Y, dx + SEARCH_X + PAD_X]
                                        + wba * sba[-dy + SEARCH_Y, ex + SEARCH_X + PAD_X])
    y, x = np.unravel_index(np.argmax(scores), scores.shape)
    top = scores[y, x]
    away = scores.copy()
    away[max(y - 3, 0):y + 4, max(x - 3, 0):x + 4] = -np.inf
    if not np.isfinite(top) or top < MIN_LEAD * away.max():
        return None
    dx, dy = (x0 - SEARCH_X + x) * SCALE, (y - SEARCH_Y) * SCALE
    ab = refine(ga, gb, dx, dy)
    ba = refine(gb, ga, gb.shape[1] - ga.shape[1] + dx, -dy)
    return ab, ba


def footprint(back_g, dx, dy, angle, shape):
    """Where the mirrored back's ink lands on the front, widened a little."""
    if angle:
        back_g = ndimage.rotate(back_g, angle, reshape=False, mode="nearest")
    ink = (1 - relative(back_g[:, ::-1])) > FOOTPRINT_INK
    out = np.zeros(shape, bool)
    h, w = ink.shape
    ys, xs = slice(max(dy, 0), min(dy + h, shape[0])), slice(max(dx, 0), min(dx + w, shape[1]))
    if ys.start < ys.stop and xs.start < xs.stop:
        out[ys, xs] = ink[ys.start - dy:ys.stop - dy, xs.start - dx:xs.stop - dx]
    return ndimage.binary_dilation(out, iterations=GROW)


def clean(front, back_g, dx, dy, angle):
    """The front with ghost pixels rebuilt from their neighborhood."""
    g = front.mean(axis=2)
    ghost = footprint(back_g, dx, dy, angle, g.shape) & (relative(g) >= KEEP)
    known = ~ghost
    weight = ndimage.gaussian_filter(known.astype(np.float32), FILL)
    out = front.copy()
    for c in range(3):
        fill = ndimage.gaussian_filter(front[..., c] * known, FILL) / np.maximum(weight, 1e-3)
        out[..., c] = np.where(ghost, np.maximum(front[..., c], fill), front[..., c])
    return out


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


def pair(pages, i):
    """The other side of page position i. Numbered pages pair by number: odd
    page N (a right page) is backed by page N + 1 (the next left page).
    Unnumbered front matter pairs by position."""
    n = pages[i].get("number") if i < len(pages) else None
    if n is not None:
        want = n + 1 if n % 2 else n - 1
        match = [j for j, p in enumerate(pages) if p.get("number") == want]
        return match[0] if match else None
    return back_of(i)


def clean_pages(scans, positions, pages=()):
    image = lambda i: scans / f"{i + 1:02d}.jpg"
    pages = list(pages)
    sheets = set()
    for i in positions:
        j = pair(pages, i) if pages else back_of(i)
        if j is not None:
            sheets.add(tuple(sorted((i, j))))
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
    import json
    scans = Path("scans") / sys.argv[1]
    notebook = Path("data/notebooks") / f"{sys.argv[1]}.json"
    pages = json.loads(notebook.read_text())["pages"] if notebook.exists() else []
    count = len([p for p in scans.glob("[0-9][0-9].jpg")])
    positions = [int(p) for p in sys.argv[2:]] or list(range(count))
    cleaned = clean_pages(scans, positions, pages)
    print(f"Cleaned {len(cleaned)} pages in {scans}/: {', '.join(str(i + 1) for i in sorted(cleaned)) or 'none'}")
