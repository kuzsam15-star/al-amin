import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("avatar crop dialog keeps actions reachable and locks background scrolling", async () => {
  const [component, styles] = await Promise.all([
    read("src/components/AvatarCropper.tsx"),
    read("src/app/additions.css"),
  ]);

  assert.match(component, /role="dialog"/);
  assert.match(component, /aria-modal="true"/);
  assert.match(component, /aria-labelledby=\{titleId\}/);
  assert.match(component, /aria-describedby=\{descriptionId\}/);
  assert.match(component, /document\.body\.style\.overflow = "hidden"/);
  assert.match(component, /document\.body\.style\.position = "fixed"/);
  assert.match(component, /document\.body\.style\.top = `-\$\{scrollPosition\}px`/);
  assert.match(component, /document\.documentElement\.style\.overflow = "hidden"/);
  assert.match(component, /document\.body\.style\.overflow = bodyOverflow/);
  assert.match(component, /window\.scrollTo\(\{ top: scrollPosition/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /event\.key !== "Tab"/);
  assert.match(component, /onCropChange=\{setCrop\}/);
  assert.match(component, /onZoomChange=\{setZoom\}/);
  assert.match(component, /onCropComplete=\{\(_, pixels\) => setArea\(pixels\)\}/);
  assert.match(component, /await onSave\(await cropToAvatar\(source, area, file\), \{ crop, zoom, croppedAreaPixels: area \}\)/);
  assert.match(component, /initialCroppedAreaPixels=\{initialSettings\?\.croppedAreaPixels\}/);

  assert.match(styles, /\.crop-dialog\{[^}]*max-height:calc\(100dvh - 36px\)[^}]*overflow:hidden/);
  assert.match(styles, /\.crop-dialog-body\{[^}]*min-height:0[^}]*overflow-y:auto[^}]*overscroll-behavior:contain/);
  assert.match(styles, /\.crop-actions\{[^}]*flex:0 0 auto[^}]*border-top/);
  assert.match(styles, /\.crop-stage\{[^}]*height:clamp\(260px,48dvh,440px\)/);
  assert.match(styles, /\.crop-dialog\{[^}]*height:100dvh[^}]*max-height:100dvh/);
});
