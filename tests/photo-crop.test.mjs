import assert from "node:assert/strict";
import test from "node:test";
import {
  cropZoomRange,
  defaultAvatarCrop,
  defaultProfileCrop,
  panPhotoCrop,
  photoCropExtractRect,
  photoCropGeometry,
  photoCropImageStyle,
  zoomPhotoCropAt,
} from "../src/lib/photo-crop.mjs";

test("zoom is an aspect-independent user multiplier with enough range for a distant subject", () => {
  assert.deepEqual(cropZoomRange, { min: 1, max: 8 });
  const profile = photoCropGeometry(1200, 2000, 5 / 6, { positionX: 50, positionY: 35, zoom: 5 });
  const avatar = photoCropGeometry(1200, 2000, 1, { positionX: 50, positionY: 35, zoom: 5 });
  assert.ok(profile.cropHeight <= 400, "A subject occupying 20% of image height can fill the profile crop.");
  assert.ok(avatar.cropHeight <= 400, "A subject occupying 20% of image height can fill the avatar crop.");
  for (const geometry of [profile, avatar]) {
    assert.ok(geometry.left >= 0 && geometry.top >= 0);
    assert.ok(geometry.left + geometry.cropWidth <= geometry.width + 0.001);
    assert.ok(geometry.top + geometry.cropHeight <= geometry.height + 0.001);
  }
  assert.equal(zoomPhotoCropAt(defaultProfileCrop, 1200, 2000, 5 / 6, 100, 0.5, 0.5).zoom, cropZoomRange.max);
});

test("profile and avatar crops remain independent and never expose empty space", () => {
  const profile = panPhotoCrop(defaultProfileCrop, 1600, 1200, 5 / 6, -160, 0, 400, 480);
  const avatar = zoomPhotoCropAt(defaultAvatarCrop, 1600, 1200, 1, 1.6, 0.72, 0.35);
  assert.notDeepEqual(profile, avatar);
  for (const [aspect, crop] of [[5 / 6, profile], [1, avatar]]) {
    const geometry = photoCropGeometry(1600, 1200, aspect, crop);
    assert.ok(geometry.left >= 0 && geometry.top >= 0);
    assert.ok(geometry.left + geometry.cropWidth <= geometry.width + 0.001);
    assert.ok(geometry.top + geometry.cropHeight <= geometry.height + 0.001);
    const style = photoCropImageStyle(1600, 1200, aspect, crop);
    assert.match(style.width, /%$/u);
    assert.match(style.left, /%$/u);
  }
});

test("pinch zoom preserves the touched source point", () => {
  const source = { width: 1200, height: 1600, aspect: 5 / 6 };
  const beforeCrop = { positionX: 40, positionY: 65, zoom: 1.15 };
  const before = photoCropGeometry(source.width, source.height, source.aspect, beforeCrop);
  const focal = { x: 0.67, y: 0.28 };
  const point = { x: before.left + focal.x * before.cropWidth, y: before.top + focal.y * before.cropHeight };
  const nextCrop = zoomPhotoCropAt(beforeCrop, source.width, source.height, source.aspect, 1.55, focal.x, focal.y);
  const after = photoCropGeometry(source.width, source.height, source.aspect, nextCrop);
  assert.ok(Math.abs(point.x - (after.left + focal.x * after.cropWidth)) < 0.001);
  assert.ok(Math.abs(point.y - (after.top + focal.y * after.cropHeight)) < 0.001);
});

test("extract rectangles match the two final image aspect ratios", () => {
  const profile = photoCropExtractRect(900, 1200, 5 / 6, { positionX: 30, positionY: 70, zoom: 1.4 });
  const avatar = photoCropExtractRect(900, 1200, 1, { positionX: 80, positionY: 20, zoom: 1.7 });
  assert.ok(Math.abs(profile.width / profile.height - 5 / 6) < 0.003);
  assert.equal(avatar.width, avatar.height);
});
