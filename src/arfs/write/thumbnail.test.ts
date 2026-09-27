import { describe, expect, it } from 'vitest';
import {
  computeLocalThumbDimensions,
  computeThumbnailDimensions,
  LOCAL_THUMB_MAX_LONG_SIDE,
  LOCAL_THUMB_SHORT_SIDE,
  THUMBNAIL_MAX_DIMENSION,
} from './thumbnail';

describe('computeThumbnailDimensions', () => {
  it('leaves an already-small image untouched', () => {
    expect(computeThumbnailDimensions(200, 100)).toEqual({ width: 200, height: 100 });
  });

  it('scales a wide image down to the max on its long side, preserving aspect ratio', () => {
    const result = computeThumbnailDimensions(4000, 2000);
    expect(result.width).toBe(THUMBNAIL_MAX_DIMENSION);
    expect(result.height).toBe(THUMBNAIL_MAX_DIMENSION / 2);
  });

  it('scales a tall image down to the max on its long side, preserving aspect ratio', () => {
    const result = computeThumbnailDimensions(2000, 4000);
    expect(result.height).toBe(THUMBNAIL_MAX_DIMENSION);
    expect(result.width).toBe(THUMBNAIL_MAX_DIMENSION / 2);
  });

  it('never upscales', () => {
    expect(computeThumbnailDimensions(50, 30, 480)).toEqual({ width: 50, height: 30 });
  });

  it('respects a custom max dimension', () => {
    const result = computeThumbnailDimensions(1000, 500, 100);
    expect(result).toEqual({ width: 100, height: 50 });
  });

  it('never produces a zero dimension for an extreme aspect ratio', () => {
    const result = computeThumbnailDimensions(10_000, 1, 480);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});

describe('computeLocalThumbDimensions', () => {
  it('sizes by the SHORT side, which is what object-cover consumes in a square tile', () => {
    // The whole point: a 4:3 photo must end up with >= LOCAL_THUMB_SHORT_SIDE on its short side,
    // where the on-chain long-side cap would have left it at only 360.
    const result = computeLocalThumbDimensions(4032, 3024);
    expect(Math.min(result.width, result.height)).toBe(LOCAL_THUMB_SHORT_SIDE);
    expect(result.width / result.height).toBeCloseTo(4032 / 3024, 2);
  });

  it('gives a 16:9 photo enough short side too — the worst case under long-side capping', () => {
    const result = computeLocalThumbDimensions(3840, 2160);
    expect(Math.min(result.width, result.height)).toBe(LOCAL_THUMB_SHORT_SIDE);
  });

  it('covers a large icon tile at DPR 2 and 3, which 480-long-side sizing did not', () => {
    const LARGE_TILE_CSS_PX = 237; // measured from the real icon-view layout
    const result = computeLocalThumbDimensions(4032, 3024);
    const shortSide = Math.min(result.width, result.height);
    expect(shortSide).toBeGreaterThanOrEqual(LARGE_TILE_CSS_PX * 2);
    expect(shortSide).toBeGreaterThanOrEqual(LARGE_TILE_CSS_PX * 3);
    // And the sizing this replaced genuinely did not, which is why tiles looked blurry.
    expect(Math.min(4032, 3024) * (480 / 4032)).toBeLessThan(LARGE_TILE_CSS_PX * 2);
  });

  it('caps the long side so a panorama does not explode chasing its short side', () => {
    const result = computeLocalThumbDimensions(12_000, 1_000);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(LOCAL_THUMB_MAX_LONG_SIDE);
  });

  it('never upscales a source that is already smaller than the target', () => {
    expect(computeLocalThumbDimensions(320, 240)).toEqual({ width: 320, height: 240 });
  });

  it('never produces a zero dimension for an extreme aspect ratio', () => {
    const result = computeLocalThumbDimensions(10_000, 1);
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});
