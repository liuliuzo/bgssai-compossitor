export const BLENDS = [
  ["source-over", "正常"],
  ["multiply", "正片叠底"],
  ["screen", "滤色"],
  ["overlay", "叠加"],
  ["darken", "变暗"],
  ["lighten", "变亮"],
  ["color-dodge", "颜色减淡"],
  ["color-burn", "颜色加深"],
  ["hard-light", "强光"],
  ["soft-light", "柔光"],
  ["difference", "差值"],
  ["exclusion", "排除"],
  ["hue", "色相"],
  ["saturation", "饱和度"],
  ["color", "颜色"],
  ["luminosity", "明度"],
] as const;
export const FONTS = ["Segoe UI", "Arial", "Georgia", "Consolas"] as const;
export type Blend = (typeof BLENDS)[number][0];
export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
}
export interface TextContent {
  value: string;
  font: (typeof FONTS)[number];
  size: number;
  color: string;
  bold: boolean;
}
export interface LayerData {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: Blend;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  adjustments: Adjustments;
  image: string;
  text?: TextContent;
}
export interface ProjectData {
  format: "bgssai-compositor";
  version: 1;
  name: string;
  width: number;
  height: number;
  layers: LayerData[];
}
export const MAX_DIMENSION = 8192;
export const MAX_DOCUMENT_PIXELS = 16_777_216;
export const MAX_LAYER_PIXELS = 48_000_000;
export const MAX_LAYERS = 40;
export const MAX_PROJECT_BYTES = 128 * 1024 * 1024;
export const defaults = (): Adjustments => ({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  blur: 0,
});

export function checkDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    width * height > MAX_DOCUMENT_PIXELS
  ) {
    throw new Error(
      "宽高须为 1–8192 的整数，总像素不超过 1677 万（如 4096 × 4096）。",
    );
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("项目结构无效。");
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error("项目中的数值超出允许范围。");
  return value;
}
function string(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max)
    throw new Error("项目中的文字数据无效或过长。");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("项目中的图层属性无效。");
  return value;
}

// Inspect IHDR before asking the image decoder to allocate memory.
export function pngDimensions(data: string): { width: number; height: number } {
  const prefix = "data:image/png;base64,";
  if (!data.startsWith(prefix)) throw new Error("项目图层必须使用内嵌 PNG。");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(
      atob(data.slice(prefix.length, prefix.length + 44)),
      (char) => char.charCodeAt(0),
    );
  } catch {
    throw new Error("PNG 图层数据损坏。");
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 24 ||
    signature.some((byte, i) => bytes[i] !== byte) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
  )
    throw new Error("PNG 图层数据损坏。");
  const view = new DataView(bytes.buffer);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  checkDimensions(width, height);
  return { width, height };
}

export function parseProject(json: string): ProjectData {
  if (new TextEncoder().encode(json).byteLength > MAX_PROJECT_BYTES)
    throw new Error("项目文件超过 128 MB。");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("项目文件不是有效的 JSON。");
  }
  const data = record(parsed);
  if (data.format !== "bgssai-compositor" || data.version !== 1)
    throw new Error("不支持的项目格式或版本。");
  const width = number(data.width, 1, MAX_DIMENSION);
  const height = number(data.height, 1, MAX_DIMENSION);
  checkDimensions(width, height);
  if (
    !Array.isArray(data.layers) ||
    data.layers.length < 1 ||
    data.layers.length > MAX_LAYERS
  )
    throw new Error("项目须包含 1–40 个图层。");
  let pixels = 0;
  const ids = new Set<string>();
  const layers = data.layers.map((value): LayerData => {
    const layer = record(value);
    const adj = record(layer.adjustments);
    const id = string(layer.id, 100);
    if (!id || ids.has(id)) throw new Error("图层 ID 重复或为空。");
    ids.add(id);
    const image = string(layer.image, MAX_PROJECT_BYTES);
    const dimensions = pngDimensions(image);
    pixels += dimensions.width * dimensions.height;
    if (pixels > MAX_LAYER_PIXELS)
      throw new Error("所有图层总像素超过 4800 万。");
    const blend = string(layer.blend, 32) as Blend;
    if (!BLENDS.some(([mode]) => mode === blend))
      throw new Error("不支持的图层混合模式。");
    let text: TextContent | undefined;
    if (layer.text !== undefined) {
      const t = record(layer.text);
      const font = string(t.font, 32) as TextContent["font"];
      if (!FONTS.includes(font) || !/^#[0-9a-f]{6}$/i.test(string(t.color, 7)))
        throw new Error("文本图层样式无效。");
      text = {
        value: string(t.value, 10000),
        font,
        size: number(t.size, 1, 512),
        color: t.color as string,
        bold: boolean(t.bold),
      };
    }
    return {
      id,
      image,
      ...(text ? { text } : {}),
      name: string(layer.name, 200),
      visible: boolean(layer.visible),
      locked: boolean(layer.locked),
      opacity: number(layer.opacity, 0, 1),
      blend,
      x: number(layer.x, -100000, 100000),
      y: number(layer.y, -100000, 100000),
      scaleX: number(layer.scaleX, 0.01, 100),
      scaleY: number(layer.scaleY, 0.01, 100),
      rotation: number(layer.rotation, -36000, 36000),
      flipX: boolean(layer.flipX),
      flipY: boolean(layer.flipY),
      adjustments: {
        brightness: number(adj.brightness, -100, 100),
        contrast: number(adj.contrast, -100, 100),
        saturation: number(adj.saturation, -100, 200),
        blur: number(adj.blur, 0, 50),
      },
    };
  });
  return {
    format: "bgssai-compositor",
    version: 1,
    name: string(data.name, 200),
    width,
    height,
    layers,
  };
}

export interface Point {
  x: number;
  y: number;
}
export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}
export function localToWorld(p: Point, g: Geometry): Point {
  const rad = (g.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const x = (p.x - g.width / 2) * g.scaleX * (g.flipX ? -1 : 1);
  const y = (p.y - g.height / 2) * g.scaleY * (g.flipY ? -1 : 1);
  return {
    x: g.x + (g.width * g.scaleX) / 2 + x * cos - y * sin,
    y: g.y + (g.height * g.scaleY) / 2 + x * sin + y * cos,
  };
}
export function worldToLocal(p: Point, g: Geometry): Point {
  const rad = (-g.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const x = p.x - g.x - (g.width * g.scaleX) / 2;
  const y = p.y - g.y - (g.height * g.scaleY) / 2;
  return {
    x: (x * cos - y * sin) / (g.scaleX * (g.flipX ? -1 : 1)) + g.width / 2,
    y: (x * sin + y * cos) / (g.scaleY * (g.flipY ? -1 : 1)) + g.height / 2,
  };
}
