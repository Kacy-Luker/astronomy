// The sketch crops the build cuts from the pages (sketches/<session>/), as
// cards that look the same everywhere:
//
// - session card: the NEW SESSION block alone (top of the session page)
// - object card: one entry alone (each observation on the session page)
// - joint card: the session's block and the entry, two images with a gap
//   (the object page). The block is always the entry's own session's, even
//   when one page holds two sessions: the build cuts it from that session's
//   header_box.
//
// Each image opens full size in view.html and follows the page's Inverted /
// Cleaned / Original view (inverted inside an element with .inverted).
import { el, imageFigure } from "./lib.js";

function card(figures) {
  const frame = el("div", "sketch-frame");
  frame.append(...figures);
  return frame;
}

export const sessionCard = (header, alt, caption) => card([imageFigure(header, alt, caption)]);

export const objectCard = (sketch, alt, caption) => card([imageFigure(sketch, alt, caption)]);

export const jointCard = (sketch, headerAlt, alt, caption) =>
  card([imageFigure(sketch.header, headerAlt), imageFigure(sketch, alt, caption)]);
