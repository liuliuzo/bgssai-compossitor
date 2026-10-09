import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkDimensions,
  defaults,
  localToWorld,
  worldToLocal,
  parseProject,
  type ProjectData,
  type Geometry,
} from "../src/project.ts";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
function project(): ProjectData {
  return {
    format: "bgssai-compositor",
    version: 1,
    name: "测试文档",
    width: 128,
    height: 96,
    layers: [
      {
        id: "one",
        name: "红色",
        visible: true,
        locked: false,
        opacity: 0.7,
        blend: "multiply",
        x: -4,
        y: 12,
        scaleX: 2,
        scaleY: 0.5,
        rotation: 30,
        flipX: true,
        flipY: false,
        adjustments: defaults(),
        image: png,
      },
    ],
  };
}
test("editable projects preserve layer metadata without accepting unknown properties", () => {
  const original = project();
  const parsed = parseProject(JSON.stringify({ ...original, admin: true }));
  assert.deepEqual(parsed, original);
  assert.equal("admin" in parsed, false);
});
test("rejects bad versions, truncated images, duplicate IDs and malformed values", () => {
  assert.throws(() => parseProject("{"), /JSON/);
  assert.throws(
    () => parseProject(JSON.stringify({ ...project(), version: 99 })),
    /版本/,
  );
  const data = project();
  data.layers[0].image = "data:image/svg+xml;base64,PHN2Zz4=";
  assert.throws(() => parseProject(JSON.stringify(data)), /PNG/);
  const duplicate = project();
  duplicate.layers.push({ ...duplicate.layers[0] });
  assert.throws(() => parseProject(JSON.stringify(duplicate)), /重复/);
  for (const patch of [
    { opacity: 2 },
    { scaleX: 0 },
    { rotation: null },
    { blend: "copy" },
    { visible: "true" },
  ]) {
    const invalid = project();
    Object.assign(invalid.layers[0], patch);
    assert.throws(() => parseProject(JSON.stringify(invalid)));
  }
});
test("rejects oversized PNG dimensions before image decoding", () => {
  const data = project();
  const bytes = Buffer.from(png.split(",")[1], "base64");
  bytes.writeUInt32BE(100000, 16);
  data.layers[0].image = `data:image/png;base64,${bytes.toString("base64")}`;
  assert.throws(() => parseProject(JSON.stringify(data)), /宽高/);
});
test("dimension limits include fractional, non-finite and excessive pixel counts", () => {
  checkDimensions(4096, 4096);
  checkDimensions(8192, 1);
  for (const dimensions of [
    [0, 1],
    [1.5, 100],
    [8193, 1],
    [8192, 8192],
    [NaN, 1],
    [Infinity, 1],
  ])
    assert.throws(() => checkDimensions(...(dimensions as [number, number])));
});
test("brush coordinates correctly invert rotated, scaled and flipped layer transforms", () => {
  for (const flipX of [true, false])
    for (const flipY of [true, false]) {
      const geometry: Geometry = {
        x: -31,
        y: 18,
        width: 160,
        height: 90,
        scaleX: 2.2,
        scaleY: 0.4,
        rotation: 137,
        flipX,
        flipY,
      };
      for (const point of [
        { x: 0, y: 0 },
        { x: 78, y: 41 },
        { x: 160, y: 90 },
      ]) {
        const restored = worldToLocal(localToWorld(point, geometry), geometry);
        assert.ok(Math.abs(restored.x - point.x) < 1e-10);
        assert.ok(Math.abs(restored.y - point.y) < 1e-10);
      }
    }
});
test("validates text layer contents and fonts", () => {
  const data = project();
  data.layers[0].text = {
    value: "你好\nCompositor",
    font: "Segoe UI",
    size: 48,
    color: "#abcdef",
    bold: true,
  };
  assert.deepEqual(
    parseProject(JSON.stringify(data)).layers[0].text,
    data.layers[0].text,
  );
  data.layers[0].text.color = "#zzzzzz";
  assert.throws(() => parseProject(JSON.stringify(data)), /样式/);
});
