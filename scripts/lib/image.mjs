// Every image operation the scripts use, in one place (docs/DEPENDENCIES.md),
// so the image library can be swapped by rewriting this file alone. Today
// it's sharp (libvips).
//
// image(input) takes a file path or a buffer and gives a chain of steps,
// applied in the order called, ending in a buffer, a file or raw pixels:
//
//   await image(file).crop(box).jpeg({ quality: 85 }).toFile(out);
//   const { data, width, height } = await image(file).grey().resize({ width: 240 }).pixels();
//
// size(input) gives { width, height }.
import sharp from "sharp";

class Image {
  constructor(input) {
    this.pipeline = sharp(input);
  }

  // Turned clockwise by degrees; with none, upright by the photo's EXIF.
  rotate(degrees) {
    this.pipeline = this.pipeline.rotate(degrees);
    return this;
  }

  // { left, top, width, height } in pixels.
  crop(box) {
    this.pipeline = this.pipeline.extract(box);
    return this;
  }

  // { width, height, fit, background, withoutEnlargement }; either side
  // alone keeps the aspect ratio.
  resize(options) {
    this.pipeline = this.pipeline.resize(options);
    return this;
  }

  grey() {
    this.pipeline = this.pipeline.greyscale();
    return this;
  }

  blur(sigma) {
    this.pipeline = this.pipeline.blur(sigma);
    return this;
  }

  // [{ input, left, top }]: images laid over this one.
  overlay(layers) {
    this.pipeline = this.pipeline.composite(layers);
    return this;
  }

  // Inverted (light for dark).
  invert() {
    this.pipeline = this.pipeline.negate({ alpha: false });
    return this;
  }

  // { quality, mozjpeg }
  jpeg(options) {
    this.pipeline = this.pipeline.jpeg(options);
    return this;
  }

  png() {
    this.pipeline = this.pipeline.png();
    return this;
  }

  buffer() {
    return this.pipeline.toBuffer();
  }

  toFile(file) {
    return this.pipeline.toFile(file);
  }

  // One byte per channel per pixel, rows top to bottom.
  async pixels() {
    const { data, info } = await this.pipeline.raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
  }
}

export const image = (input) => new Image(input);

export async function size(input) {
  const { width, height } = await sharp(input).metadata();
  return { width, height };
}

// A blank image of one colour ("#rrggbb"), e.g. for drawing on.
export const blank = (width, height, colour) =>
  new Image({ create: { width, height, channels: 3, background: colour } });
