/**
 * Client-side thumbnail generation for image uploads — the only canvas-touching code in the app.
 *
 * Matches ArDrive's own convention (verified against `ardrive-web`'s `Thumbnail`/`Variant`
 * classes — see the thumbnails plan): a small JPEG, uploaded as its own data transaction,
 * referenced from the file's metadata JSON. The exact pixel size isn't part of that interop
 * contract — only the `{name, txId, size, width, height}` JSON shape is — so the numbers below are
 * a reasonable default, not a spec to match.
 */

export const THUMBNAIL_MAX_DIMENSION = 480;
export const THUMBNAIL_JPEG_QUALITY = 0.82;

/**
 * Sizing for a *locally cached* thumbnail — deliberately different from the on-chain one above,
 * and the fix for the real cause of "blurry thumbnails."
 *
 * The UI paints thumbnails with `object-cover` inside a **square** box, so the image's **short**
 * side is what has to cover the box — capping the *long* side (as `THUMBNAIL_MAX_DIMENSION` does)
 * constrains the wrong dimension entirely. Measured against the real layout: a large icon tile is
 * ~237 CSS px, which on a DPR-2 display needs 474 real pixels, but a 480-max thumbnail of a 4:3
 * photo only carries 360 px on its short side — a 1.32x upscale (1.75x for 16:9). That upscale,
 * not the resampling algorithm, is what actually looks blurry.
 *
 * 768 covers a large tile at DPR 2 with real headroom, and most tile sizes at DPR 3. The long-side
 * cap keeps a panorama from exploding into a huge blob just to satisfy its short side. These are
 * local-only bytes (never uploaded, never on chain), so unlike the on-chain size these cost the
 * user nothing but disk — the tradeoff is roughly 150-250KB per cached image instead of ~25KB,
 * still an order of magnitude smaller than the multi-MB original it saves re-fetching.
 */
export const LOCAL_THUMB_SHORT_SIDE = 768;
export const LOCAL_THUMB_MAX_LONG_SIDE = 1536;

/**
 * Scale so the **short** side reaches `LOCAL_THUMB_SHORT_SIDE` (bounded by a long-side cap), never
 * upscaling a source that is already smaller. See `LOCAL_THUMB_SHORT_SIDE` for why this targets
 * the short side where `computeThumbnailDimensions` targets the long one.
 */
export function computeLocalThumbDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (!short || !long) return { width, height };

  // `Math.min(..., 1)` is what makes this never upscale — a source smaller than the target keeps
  // its own size rather than being blown up into a bigger, blurrier file for no added detail.
  const scale = Math.min(LOCAL_THUMB_SHORT_SIDE / short, LOCAL_THUMB_MAX_LONG_SIDE / long, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface GeneratedThumbnail {
  blob: Blob;
  width: number;
  height: number;
}

/** Aspect-ratio-preserving scale to fit within `maxDimension` on the long side — never upscales. */
export function computeThumbnailDimensions(
  width: number,
  height: number,
  maxDimension: number = THUMBNAIL_MAX_DIMENSION,
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) return { width, height };
  const scale = maxDimension / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(width: number, height: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: Canvas2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    return { canvas, ctx };
  }
  // Fallback for environments without OffscreenCanvas.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  return { canvas, ctx };
}

/** `HTMLCanvasElement.toBlob` is callback-based; unify it with `OffscreenCanvas.convertToBlob`. */
function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement, quality: number): Promise<Blob | null> {
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

/**
 * Downscales to `targetWidth`x`targetHeight` and returns a JPEG blob, by **halving repeatedly**
 * rather than drawing the full-resolution source to the target size in one pass. A single
 * `drawImage` step is sharp for any reduction under ~2x, but browsers' bilinear resampling —
 * even at `imageSmoothingQuality: 'high'` — renders visibly soft/mushy for a large ratio in one
 * jump (a 6000px photo down to 480px is a 12x reduction). Halving down to within 2x of the
 * target first, then doing one final precise draw, keeps every individual step sharp without
 * needing a slow custom resampling kernel.
 */
export async function rasterize(bitmap: ImageBitmap, targetWidth: number, targetHeight: number): Promise<Blob | null> {
  let sourceWidth = bitmap.width;
  let sourceHeight = bitmap.height;
  let source: CanvasImageSource = bitmap;

  try {
    // Halve both dimensions unconditionally, not clamped independently to `targetWidth`/
    // `targetHeight` — `computeThumbnailDimensions` already guarantees the target has the same
    // aspect ratio as the source, so the two halved dimensions stay in lockstep and the loop
    // condition (checked *before* each halving) already guarantees neither ever drops below its
    // target. An earlier version clamped each dimension to its own target independently, which
    // for a non-square image let one dimension reach its floor before the other — the final draw
    // then had to cover a much bigger single-step ratio on whichever dimension lagged behind,
    // reintroducing exactly the softness this function exists to avoid, just on one axis instead
    // of both.
    while (sourceWidth > targetWidth * 2 && sourceHeight > targetHeight * 2) {
      const nextWidth = Math.round(sourceWidth / 2);
      const nextHeight = Math.round(sourceHeight / 2);
      const { canvas, ctx } = makeCanvas(nextWidth, nextHeight);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, nextWidth, nextHeight);
      source = canvas;
      sourceWidth = nextWidth;
      sourceHeight = nextHeight;
    }

    const { canvas, ctx } = makeCanvas(targetWidth, targetHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
    return await canvasToBlob(canvas, THUMBNAIL_JPEG_QUALITY);
  } catch {
    return null;
  }
}

/**
 * Generate a downscaled JPEG thumbnail for an image file. Returns `null` — never throws — for
 * anything that can't be decoded (an unusual format, a corrupt file): a bad thumbnail should never
 * block the real upload, so callers just skip the thumbnail on `null`.
 */
export async function generateImageThumbnail(file: File): Promise<GeneratedThumbnail | null> {
  let bitmap: ImageBitmap;
  try {
    // `imageOrientation: 'from-image'` is required, not cosmetic: a real phone photo very often
    // carries an EXIF `Orientation` tag (sensor captured "sideways", metadata says how to rotate
    // it for display). A plain `<img>` tag honors that automatically; `createImageBitmap` does
    // not unless told to, so without this a portrait photo decodes using its raw sensor-native
    // landscape pixel grid — the generated thumbnail comes out rotated (and often mirrored)
    // relative to how every other viewer, including this app's own full-image fallback, shows
    // the same file. Squeezed into a differently-shaped thumbnail box, a 90°-rotated photo reads
    // as genuinely garbled, not just "sideways."
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }

  try {
    const { width, height } = computeThumbnailDimensions(bitmap.width, bitmap.height);
    const blob = await rasterize(bitmap, width, height);
    if (!blob) return null;
    return { blob, width, height };
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}
