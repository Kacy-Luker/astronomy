// A link to a photo of an object's patch of sky (#126): Aladin Lite, CDS's
// sky viewer, centred on the object's RA/Dec with the DSS2 colour survey.
// It's an outside service (docs/DEPENDENCIES.md); its address is PHOTO,
// credited beside the link. Another viewer only needs a URL that takes a
// position and a field of view.
export const PHOTO = {
  url: "https://aladin.cds.unistra.fr/AladinLite/",
  survey: "P/DSS2/color",
  name: "Aladin Lite",
  credit: "DSS2 colour, CDS",
};

// Field of view in degrees: three times the object's largest size, kept
// between MIN and MAX; DEFAULT when the size isn't known.
const DEFAULT_FOV = 0.5;
const MIN_FOV = 0.1;
const MAX_FOV = 5;
const UNITS = { "°": 1, "′": 1 / 60, "'": 1 / 60, "″": 1 / 3600, '"': 1 / 3600 };

// The largest dimension of a size like "178′ × 70′" or "31′", in degrees.
export function sizeDegrees(size) {
  if (typeof size !== "string") return null;
  const parts = [...size.matchAll(/(\d+(?:\.\d+)?)\s*([°′'″"])/g)].map(([, n, u]) => Number(n) * UNITS[u]);
  return parts.length ? Math.max(...parts) : null;
}

export function photoFov(size) {
  const deg = sizeDegrees(size);
  if (!deg) return DEFAULT_FOV;
  return Math.round(Math.min(MAX_FOV, Math.max(MIN_FOV, deg * 3)) * 100) / 100;
}

// The viewer's address for an object's catalog info, or null without RA/Dec.
export function photoUrl(info) {
  const ra = info?.ra, dec = info?.dec;
  if (typeof ra !== "string" || typeof dec !== "string" || !ra.trim() || !dec.trim()) return null;
  const params = [
    ["target", `${ra.trim()} ${dec.trim()}`],
    ["fov", String(photoFov(info.size))],
    ["survey", PHOTO.survey],
  ];
  return `${PHOTO.url}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}
