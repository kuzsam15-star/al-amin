import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { photoCropExtractRect } from "../src/lib/photo-crop.mjs";

test("phone EXIF orientation is normalized before either crop is baked", async () => {
  const phoneJpeg = await sharp({
    create: { width: 800, height: 1200, channels: 3, background: { r: 42, g: 91, b: 68 } },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

  const normalized = await sharp(phoneJpeg).rotate().toBuffer();
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 800);
  assert.equal(metadata.orientation, undefined);

  const profileRect = photoCropExtractRect(metadata.width, metadata.height, 5 / 6, { positionX: 30, positionY: 70, zoom: 1.35 });
  const avatarRect = photoCropExtractRect(metadata.width, metadata.height, 1, { positionX: 70, positionY: 30, zoom: 1.6 });
  const [profile, avatar] = await Promise.all([
    sharp(normalized).extract(profileRect).resize(500, 600, { fit: "fill" }).webp().toBuffer(),
    sharp(normalized).extract(avatarRect).resize(480, 480, { fit: "fill" }).webp().toBuffer(),
  ]);
  const [profileMetadata, avatarMetadata] = await Promise.all([sharp(profile).metadata(), sharp(avatar).metadata()]);
  assert.deepEqual([profileMetadata.width, profileMetadata.height], [500, 600]);
  assert.deepEqual([avatarMetadata.width, avatarMetadata.height], [480, 480]);
  assert.equal(profileMetadata.orientation, undefined);
  assert.equal(avatarMetadata.orientation, undefined);
});
