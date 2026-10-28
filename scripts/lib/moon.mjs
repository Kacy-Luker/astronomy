// The Moon at an observation (#127): its phase, how much of it was lit, and
// whether it was above the horizon at the site. Worked out at build time
// and stored on each observation, so the site needs no library and no
// outside service. A short computation of our own, no dependency:
//
// - the Moon's ecliptic position from the low-precision series in
//   Montenbruck & Pfleger, "Astronomy on the Personal Computer" (MiniMoon,
//   good to a few arcminutes), and the Sun's from the Astronomical
//   Almanac's low-precision formulas (about 0.01°);
// - the lit fraction from the Sun–Moon elongation (Meeus, "Astronomical
//   Algorithms", ch. 48), to well under 1%;
// - the altitude from sidereal time, with the Moon's parallax taken off.
//
// That's far finer than the answers need (a glyph, a whole percent, up or
// down), but the time it's worked out for is approximate: see when().

const RAD = Math.PI / 180;
const ARC = 206264.8062; // arcseconds per radian
const frac = (x) => x - Math.floor(x);
const mod360 = (x) => ((x % 360) + 360) % 360;
const julian = (date) => date.getTime() / 86400000 + 2440587.5;

// The Moon's ecliptic longitude and latitude (degrees, of date).
function moonEcliptic(jd) {
  const T = (jd - 2451545) / 36525;
  const L0 = frac(0.606433 + 1336.855225 * T);
  const l = 2 * Math.PI * frac(0.374897 + 1325.55241 * T); // Moon's mean anomaly
  const ls = 2 * Math.PI * frac(0.993133 + 99.997361 * T); // Sun's mean anomaly
  const D = 2 * Math.PI * frac(0.827361 + 1236.853086 * T); // mean elongation
  const F = 2 * Math.PI * frac(0.259086 + 1342.227825 * T); // argument of latitude
  const dL = 22640 * Math.sin(l) - 4586 * Math.sin(l - 2 * D) + 2370 * Math.sin(2 * D) + 769 * Math.sin(2 * l)
    - 668 * Math.sin(ls) - 412 * Math.sin(2 * F) - 212 * Math.sin(2 * l - 2 * D) - 206 * Math.sin(l + ls - 2 * D)
    + 192 * Math.sin(l + 2 * D) - 165 * Math.sin(ls - 2 * D) - 125 * Math.sin(D) - 110 * Math.sin(l + ls)
    + 148 * Math.sin(l - ls) - 55 * Math.sin(2 * F - 2 * D);
  const S = F + (dL + 412 * Math.sin(2 * F) + 541 * Math.sin(ls)) / ARC;
  const h = F - 2 * D;
  const N = -526 * Math.sin(h) + 44 * Math.sin(l + h) - 31 * Math.sin(-l + h) - 23 * Math.sin(ls + h)
    + 11 * Math.sin(-ls + h) - 25 * Math.sin(-2 * l + F) + 21 * Math.sin(-l + F);
  return { lon: 360 * frac(L0 + dL / 1296000), lat: (18520 * Math.sin(S) + N) / 3600 };
}

// The Sun's ecliptic longitude (degrees).
function sunLongitude(jd) {
  const n = jd - 2451545;
  const g = (357.528 + 0.9856003 * n) * RAD;
  return mod360(280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
}

export const PHASES = [
  "New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
  "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent",
];

// The Moon at an instant (a Date), and at a site when lat and lon (degrees,
// east positive) are numbers:
// - phase: 0 to 1 through the cycle (0 new, 0.25 first quarter, 0.5 full)
// - illumination: the lit fraction, 0 to 1
// - name: one of PHASES, each the eighth of the cycle around its point
// - altitude (degrees, at the site) and up, with a site
export function moonAt(date, lat, lon) {
  const jd = julian(date);
  const moon = moonEcliptic(jd);
  const elongation = mod360(moon.lon - sunLongitude(jd));
  // The phase angle is 180° less the Sun–Moon angle, to within 0.2°.
  const cosPsi = Math.cos(moon.lat * RAD) * Math.cos(elongation * RAD);
  const illumination = (1 - cosPsi) / 2;
  const phase = elongation / 360;
  const out = { phase, illumination, name: PHASES[Math.floor(phase * 8 + 0.5) % 8] };
  if (typeof lat !== "number" || typeof lon !== "number") return out;

  // Equatorial coordinates, then the hour angle from local sidereal time.
  const eps = (23.439 - 0.0000004 * (jd - 2451545)) * RAD;
  const lam = moon.lon * RAD, bet = moon.lat * RAD;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps), Math.cos(lam));
  const dec = Math.asin(Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam));
  const lst = mod360(280.46061837 + 360.98564736629 * (jd - 2451545) + lon) * RAD;
  const H = lst - ra, phi = lat * RAD;
  const geocentric = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // Seen from the ground the Moon sits about 0.95° lower (its parallax).
  const altitude = geocentric / RAD - 0.95 * Math.cos(geocentric);
  // Up once its top edge clears the horizon: refraction lifts it about
  // 0.57° there and its radius is about 0.26°.
  return { ...out, altitude, up: altitude > -0.83 };
}

const TIME = /^(\d{1,2}):(\d{2})$/;
const clock = (t) => {
  const m = typeof t === "string" && TIME.exec(t.trim());
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? { h: Number(m[1]), m: Number(m[2]) } : null;
};

// The instant an observation was made, from the session's date and the
// entry's times. This is approximate: local times are written without a
// time zone, so they're taken as local mean solar time at the site
// (UT = local − longitude / 15 h), or as UTC−6 (Central Standard) when the
// site has no longitude; that can be an hour or so out, against daylight
// saving or the zone's edges. A UT written on the sheet wins for the time
// of day, on whichever date puts it nearest the local estimate. Times
// before noon are after midnight, on the day after the session's date (the
// date the night started). With no time at all, 22:00 local stands in.
// Returns { date, timed }, or null when the session's date is unreadable.
export function when(day, localTime, ut, lon) {
  const base = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(base)) return null;
  const local = clock(localTime);
  const t = local ?? { h: 22, m: 0 };
  const hours = (t.h < 12 ? t.h + 24 : t.h) + t.m / 60;
  const offset = typeof lon === "number" ? lon / 15 : -6;
  const estimate = base + (hours - offset) * 3600000;
  const u = clock(ut);
  if (!u) return { date: new Date(estimate), timed: Boolean(local) };
  const candidates = [-1, 0, 1, 2].map((d) => base + (d * 24 + u.h + u.m / 60) * 3600000);
  const nearest = candidates.reduce((a, b) => (Math.abs(b - estimate) < Math.abs(a - estimate) ? b : a));
  return { date: new Date(nearest), timed: true };
}

// What the build stores on an observation (o.moon), or null without a
// usable date: the phase and lit fraction (rounded), the phase name, and,
// with a time and the site's coordinates, whether the Moon was up and how
// high (whole degrees). Without a time, up is left out: it changes through
// the night.
export function observationMoon(session, o) {
  const { lat, lon } = session.site ?? {};
  const at = when(session.date, o.local_time, o.ut, lon);
  if (!at) return null;
  const m = moonAt(at.date, lat, lon);
  const out = {
    phase: Math.round(m.phase * 1000) / 1000,
    illumination: Math.round(m.illumination * 100),
    name: m.name,
    timed: at.timed,
  };
  if (at.timed && m.up != null) Object.assign(out, { up: m.up, altitude: Math.round(m.altitude) });
  return out;
}
