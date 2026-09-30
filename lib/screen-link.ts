import { asset } from "@/lib/base-path";
import { extractChessComGameLink, extractChessComPlayMode } from "@/lib/game-link";

const WHITELIST = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:/._-?=&";

type OcrWorker = {
  recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

export async function createScreenReader(): Promise<OcrWorker> {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: asset("/tesseract/worker.min.js"),
    corePath: asset("/tesseract/tesseract-core-simd-lstm.wasm.js"),
    langPath: asset("/tesseract"),
    workerBlobURL: false,
    gzip: true,
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    tessedit_char_whitelist: WHITELIST,
    user_defined_dpi: "300",
  });
  return worker;
}

export async function readScreenHint(
  worker: OcrWorker,
  video: HTMLVideoElement,
  full: boolean,
): Promise<{ link: string | null; mode: "bot" | "coach" | null }> {
  const bands = full ? bandTops(video.videoHeight) : [0];
  let link: string | null = null;
  let mode: "bot" | "coach" | null = null;
  for (const top of bands) {
    const canvas = frameCanvas(video, top, full);
    if (!canvas) continue;
    const result = await worker.recognize(canvas);
    const text = result.data.text;
    link = link ?? extractChessComGameLink(text);
    mode = mode ?? extractChessComPlayMode(text);
    if (link) break;
  }
  return { link, mode };
}

function bandTops(height: number): number[] {
  const band = Math.max(90, Math.round(height * 0.18));
  const tops: number[] = [];
  for (let top = 0; top < height && tops.length < 6; top += Math.round(band * 0.7)) {
    tops.push(top);
  }
  return tops;
}

function frameCanvas(video: HTMLVideoElement, sourceTop: number, full: boolean): HTMLCanvasElement | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width < 40 || height < 40) return null;
  const sourceHeight = Math.max(72, Math.round(height * (full ? 0.18 : 0.22)));
  const clippedTop = Math.min(sourceTop, Math.max(0, height - sourceHeight));
  const targetWidth = Math.min(full ? 1400 : 1800, width * 2);
  const scale = targetWidth / width;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    video,
    0,
    clippedTop,
    width,
    Math.min(sourceHeight, height - clippedTop),
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  let total = 0;
  let count = 0;
  const step = Math.max(1, Math.floor(pixels.length / 4 / 3000));
  for (let index = 0; index < pixels.length; index += step * 4) {
    total += pixels[index] * 0.3 + pixels[index + 1] * 0.59 + pixels[index + 2] * 0.11;
    count += 1;
  }
  const dark = total / count < 120;
  for (let index = 0; index < pixels.length; index += 4) {
    let value = pixels[index] * 0.3 + pixels[index + 1] * 0.59 + pixels[index + 2] * 0.11;
    if (dark) value = 255 - value;
    value = (value - 128) * 1.35 + 128;
    const gray = Math.max(0, Math.min(255, value));
    pixels[index] = gray;
    pixels[index + 1] = gray;
    pixels[index + 2] = gray;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
