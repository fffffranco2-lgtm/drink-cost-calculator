import type { QzTextSizePreset } from "@/lib/qz-tray";

export const QZ_SIZE_TO_SCALE: Record<QzTextSizePreset, number> = {
  normal: 1,
  "2x": 2,
  "3x": 3,
};

export function toLatin1Safe(value: string) {
  const normalized = value
    .normalize("NFC")
    .replaceAll("\u2018", "'")
    .replaceAll("\u2019", "'")
    .replaceAll("\u201c", '"')
    .replaceAll("\u201d", '"')
    .replaceAll("\u2013", "-")
    .replaceAll("\u2014", "-")
    .replaceAll("\u2026", "...");

  let output = "";
  for (const char of normalized) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 255)) {
      output += char;
    } else {
      output += "?";
    }
  }
  return output;
}

export function columnsForSize(baseWidth: number, preset: QzTextSizePreset) {
  return Math.max(8, Math.floor(baseWidth / QZ_SIZE_TO_SCALE[preset]));
}

export function fitPresetToContent(baseWidth: number, preferred: QzTextSizePreset, minColumns: number): QzTextSizePreset {
  let preset = preferred;
  while (preset !== "normal" && columnsForSize(baseWidth, preset) < minColumns) {
    preset = preset === "3x" ? "2x" : "normal";
  }
  return preset;
}

export function wrapText(text: string, width: number) {
  if (width <= 0) return [text];
  const parts: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const baseLine of lines) {
    let line = baseLine.trim();
    if (!line) {
      parts.push("");
      continue;
    }
    while (line.length > width) {
      const chunk = line.slice(0, width);
      const breakAt = chunk.lastIndexOf(" ");
      if (breakAt > Math.floor(width * 0.5)) {
        parts.push(chunk.slice(0, breakAt).trimEnd());
        line = line.slice(breakAt + 1).trimStart();
      } else {
        parts.push(chunk);
        line = line.slice(width);
      }
    }
    parts.push(line);
  }
  return parts.length ? parts : [""];
}

export function leftRightLine(left: string, right: string, width: number) {
  const safeLeft = left.replace(/\s+/g, " ").trim();
  const safeRight = right.replace(/\s+/g, " ").trim();
  const minGap = 1;
  const maxLeftLen = Math.max(0, width - safeRight.length - minGap);
  const croppedLeft = safeLeft.length > maxLeftLen ? safeLeft.slice(0, maxLeftLen) : safeLeft;
  const spaces = Math.max(minGap, width - croppedLeft.length - safeRight.length);
  return `${croppedLeft}${" ".repeat(spaces)}${safeRight}`;
}

export function buildEscPosBitImage24(raster: Uint8Array, widthDots: number, heightDots: number) {
  const out: string[] = [];
  const widthBytes = widthDots / 8;
  const getPixel = (x: number, y: number) => {
    const byte = raster[y * widthBytes + (x >> 3)];
    return (byte & (0x80 >> (x & 7))) !== 0;
  };

  out.push("\x1B\x61\x01"); // center
  out.push("\x1B\x33\x18"); // line spacing = 24

  for (let y = 0; y < heightDots; y += 24) {
    out.push(`\x1B\x2A\x21${String.fromCharCode(widthDots & 0xff, (widthDots >> 8) & 0xff)}`);
    for (let x = 0; x < widthDots; x += 1) {
      for (let band = 0; band < 3; band += 1) {
        let slice = 0;
        for (let bit = 0; bit < 8; bit += 1) {
          const yy = y + band * 8 + bit;
          if (yy >= heightDots) continue;
          if (getPixel(x, yy)) slice |= 0x80 >> bit;
        }
        out.push(String.fromCharCode(slice));
      }
    }
    out.push("\n");
  }

  out.push("\x1B\x32"); // default line spacing
  out.push("\x1B\x61\x00"); // left
  return out.join("");
}

export function rasterBytesToString(raster: Uint8Array) {
  let out = "";
  for (let i = 0; i < raster.length; i += 1) out += String.fromCharCode(raster[i]);
  return out;
}

export function buildEscPosRasterGSv0(raster: Uint8Array, widthDots: number, heightDots: number) {
  const widthBytes = Math.max(1, Math.floor(widthDots / 8));
  return `\x1D\x76\x30\x00${String.fromCharCode(
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    heightDots & 0xff,
    (heightDots >> 8) & 0xff,
  )}${rasterBytesToString(raster)}`;
}

export async function buildEscPosRasterLogo(imagePath: string, maxWidthDots = 384, maxHeightDots = 160) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.decoding = "async";
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Falha ao carregar logo para impressão."));
    el.src = imagePath;
  });

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("Logo sem dimensões válidas para impressão.");
  }

  let targetWidth = Math.max(8, Math.floor(Math.min(maxWidthDots, sourceWidth) / 8) * 8);
  let targetHeight = Math.max(8, Math.round((sourceHeight * targetWidth) / sourceWidth));
  if (targetHeight > maxHeightDots) {
    const scale = maxHeightDots / targetHeight;
    targetHeight = maxHeightDots;
    targetWidth = Math.max(8, Math.floor((targetWidth * scale) / 8) * 8);
  }
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Contexto 2D indisponível para rasterizar logo.");
  }

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight).data;
  const widthBytes = targetWidth / 8;
  const raster = new Uint8Array(widthBytes * targetHeight);

  for (let y = 0; y < targetHeight; y++) {
    for (let xByte = 0; xByte < widthBytes; xByte++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xByte * 8 + bit;
        const offset = (y * targetWidth + x) * 4;
        const r = imageData[offset];
        const g = imageData[offset + 1];
        const b = imageData[offset + 2];
        const alpha = imageData[offset + 3] / 255;
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        const composite = 255 - alpha * (255 - luminance);
        if (composite < 160) {
          byte |= 0x80 >> bit;
        }
      }
      raster[y * widthBytes + xByte] = byte;
    }
  }

  return buildEscPosBitImage24(raster, targetWidth, targetHeight);
}
