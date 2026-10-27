// Shared by the catalog sources: designations and constellation names.
import { CATALOGS } from "../../../site/catalog.js";

export const CONSTELLATIONS = Object.fromEntries(`And Andromeda|Ant Antlia|Aps Apus|Aqr Aquarius|Aql Aquila|Ara Ara|Ari Aries|Aur Auriga|Boo Boötes|Cae Caelum|Cam Camelopardalis|Cnc Cancer|CVn Canes Venatici|CMa Canis Major|CMi Canis Minor|Cap Capricornus|Car Carina|Cas Cassiopeia|Cen Centaurus|Cep Cepheus|Cet Cetus|Cha Chamaeleon|Cir Circinus|Col Columba|Com Coma Berenices|CrA Corona Australis|CrB Corona Borealis|Crv Corvus|Crt Crater|Cru Crux|Cyg Cygnus|Del Delphinus|Dor Dorado|Dra Draco|Equ Equuleus|Eri Eridanus|For Fornax|Gem Gemini|Gru Grus|Her Hercules|Hor Horologium|Hya Hydra|Hyi Hydrus|Ind Indus|Lac Lacerta|Leo Leo|LMi Leo Minor|Lep Lepus|Lib Libra|Lup Lupus|Lyn Lynx|Lyr Lyra|Men Mensa|Mic Microscopium|Mon Monoceros|Mus Musca|Nor Norma|Oct Octans|Oph Ophiuchus|Ori Orion|Pav Pavo|Peg Pegasus|Per Perseus|Phe Phoenix|Pic Pictor|Psc Pisces|PsA Piscis Austrinus|Pup Puppis|Pyx Pyxis|Ret Reticulum|Sge Sagitta|Sgr Sagittarius|Sco Scorpius|Scl Sculptor|Sct Scutum|Ser Serpens|Sex Sextans|Tau Taurus|Tel Telescopium|Tri Triangulum|TrA Triangulum Australe|Tuc Tucana|UMa Ursa Major|UMi Ursa Minor|Vel Vela|Vir Virgo|Vol Volans|Vul Vulpecula`
  .split("|").map((s) => [s.slice(0, s.indexOf(" ")), s.slice(s.indexOf(" ") + 1)]));

const ALIASES = { MESSIER: "M", CALDWELL: "C", MELOTTE: "MEL", COLLINDER: "CR" };
const PREFIXES = { M: "M", NGC: "NGC", IC: "IC", C: "C", MEL: "Mel", CR: "Cr", B: "B", H: "H" };
// Catalogs whose name ends in a digit, written with a hyphen before the
// number (Sh2-155), so the name's digit isn't read as the number.
const NUMBERED = { SH2: "Sh2" };

// "m 31", "Messier31", "NGC0224", "ngc 224" -> "M31", "NGC 224"; "Sh 2-155"
// -> "Sh2-155". Messier keeps no space, as written in the notebook; other
// catalogs get one. Null for anything that isn't a catalog designation.
export function normalize(id) {
  const squashed = String(id).trim().toUpperCase().replace(/\s+/g, "");
  const numbered = squashed.match(/^([A-Z]+\d)-?0*(\d+)([A-Z]?)$/);
  if (numbered && NUMBERED[numbered[1]]) return `${NUMBERED[numbered[1]]}-${Number(numbered[2])}${numbered[3]}`;
  const m = squashed.match(/^([A-Z]+?)0*(\d+)([A-Z]?)(-\d+)?$/);
  if (!m) return null;
  const letters = ALIASES[m[1]] ?? m[1];
  const prefix = PREFIXES[letters] ?? letters;
  return `${prefix}${prefix === "M" ? "" : " "}${Number(m[2])}${m[3]}${m[4] ?? ""}`;
}

// Lookup key for any designation, including ones normalize() doesn't parse
// (e.g. "2MASX J00424433+4116074").
export const keyOf = (id) => normalize(id) ?? String(id).toUpperCase().replace(/\s+/g, "");

// { catalog: "Messier", object: "102" } -> "M102". The catalog is one of
// site/catalog.js's names (Messier, NGC, IC, Caldwell) or a prefix (Sh2).
export function designation({ catalog, object }) {
  const prefix = CATALOGS.find((c) => c.name.toLowerCase() === catalog.trim().toLowerCase())?.prefix ?? catalog.trim();
  // A prefix ending in a digit takes a hyphen: Sh2-155.
  return normalize(`${prefix}${/\d$/.test(prefix) ? "-" : ""}${object.trim()}`);
}
