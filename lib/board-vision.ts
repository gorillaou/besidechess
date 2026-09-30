import { hostedWithoutServer } from "@/lib/base-path";

const CODES = ["wp", "wn", "wb", "wr", "wq", "wk", "bp", "bn", "bb", "br", "bq", "bk"] as const;
const SETS = ["neo", "classic", "alpha", "neo_wood", "wood"] as const;

export type BoardBox = { x: number; y: number; size: number };

export type PieceSet = {
  name: string;
  images: Record<string, CanvasImageSource>;
};

type RGB = [number, number, number];

export async function loadPieceSets(): Promise<PieceSet[]> {
  const loaded = await Promise.all(
    SETS.map(async (name) => {
      try {
        const images: Record<string, HTMLImageElement> = {};
        await Promise.all(
          CODES.map(async (code) => {
            images[code] = await loadImage(pieceUrl(name, code));
          }),
        );
        const set: PieceSet = { name, images };
        return set;
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter((set) => set !== null);
}

export function readBoardFromVideo(
  video: HTMLVideoElement,
  sets: PieceSet[],
  whiteAtBottom: boolean,
  hint?: BoardBox | null,
): { fen: string; box: BoardBox } | null {
  if (video.videoWidth < 80 || video.videoHeight < 80 || sets.length === 0) return null;
  const scale = Math.min(1, 960 / video.videoWidth);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const frame = ctx.getImageData(0, 0, width, height);
  const scaledHint = hint
    ? { x: Math.round(hint.x * scale), y: Math.round(hint.y * scale), size: Math.round(hint.size * scale) }
    : null;
  const found = recognizePosition(frame, sets, whiteAtBottom, scaledHint);
  if (!found) return null;
  return {
    fen: found.fen,
    box: {
      x: found.box.x / scale,
      y: found.box.y / scale,
      size: found.box.size / scale,
    },
  };
}

export function recognizePosition(
  frame: ImageData,
  sets: PieceSet[],
  whiteAtBottom: boolean,
  hint?: BoardBox | null,
): { fen: string; box: BoardBox } | null {
  const box = findBoard(frame, hint);
  if (!box) return null;
  let best: { fen: string; score: number } | null = null;
  for (const set of sets) {
    const read = readPieces(frame, box, set, whiteAtBottom);
    if (!read) continue;
    if (!best || read.score < best.score) best = read;
  }
  return best ? { fen: best.fen, box } : null;
}

export function rotateFen180(fen: string): string {
  const [placement, turn = "w", castle = "-", ep = "-", half = "0", full = "1"] = fen.split(" ");
  const rows = placement.split("/").map(expandRank);
  const rotated = rows
    .slice()
    .reverse()
    .map((row) => row.split("").reverse().join(""));
  const nextPlacement = rotated.map(compressRank).join("/");
  const rights = castlingFromPlacement(nextPlacement);
  return `${nextPlacement} ${turn} ${rights} ${ep === "-" ? "-" : "-"} ${half} ${full}`;
}

function findBoard(frame: ImageData, hint?: BoardBox | null): BoardBox | null {
  if (hint && checkerScore(frame, hint) >= 60) return refine(frame, hint);
  const { width, height } = frame;
  const minSize = Math.max(18, Math.floor(Math.min(width, height) / 22));
  const maxSize = Math.floor(Math.min(width, height) / 8);
  let best: BoardBox | null = null;
  let bestScore = 59;
  for (let size = maxSize; size >= minSize; size -= 3) {
    const board = size * 8;
    for (let y = 0; y + board <= height; y += 6) {
      for (let x = 0; x + board <= width; x += 6) {
        if (!quickChecker(frame, x, y, size)) continue;
        const score = checkerScore(frame, { x, y, size });
        if (score > bestScore) {
          bestScore = score;
          best = { x, y, size };
        }
      }
    }
  }
  if (!best) return null;
  const snapped = clampBox(frame, refine(frame, snapBoard(frame, best)));
  if (snapped.x + snapped.size * 8 > frame.width || snapped.y + snapped.size * 8 > frame.height) return null;
  return snapped;
}

function clampBox(frame: ImageData, box: BoardBox): BoardBox {
  const size = Math.max(16, box.size);
  return {
    size,
    x: Math.max(0, Math.min(box.x, frame.width - size * 8)),
    y: Math.max(0, Math.min(box.y, frame.height - size * 8)),
  };
}

function snapBoard(frame: ImageData, rough: BoardBox): BoardBox {
  const horizontal = colorRuns(frame, rough, "x");
  const vertical = colorRuns(frame, rough, "y");
  const lengths = [...horizontal.lengths, ...vertical.lengths].filter(
    (length) => Math.abs(length - rough.size) < rough.size * 0.4,
  );
  const size = Math.max(16, Math.round(median(lengths) || rough.size));
  return {
    x: alignOrigin(horizontal.cuts, size, rough.x),
    y: alignOrigin(vertical.cuts, size, rough.y),
    size,
  };
}

function colorRuns(
  frame: ImageData,
  rough: BoardBox,
  axis: "x" | "y",
): { cuts: number[]; lengths: number[] } {
  const cuts: number[] = [];
  const lengths: number[] = [];
  for (let index = 0; index < 8; index += 1) {
    const fixed = Math.round(
      (axis === "x" ? rough.y : rough.x) + index * rough.size + rough.size * 0.22,
    );
    const start = Math.max(0, Math.round((axis === "x" ? rough.x : rough.y) - rough.size));
    const limit = axis === "x" ? frame.width : frame.height;
    const end = Math.min(limit - 1, Math.round((axis === "x" ? rough.x : rough.y) + rough.size * 9));
    let last = start;
    let previous = axis === "x" ? pixel(frame, start, fixed) : pixel(frame, fixed, start);
    for (let cursor = start + 1; cursor <= end; cursor += 1) {
      const color = axis === "x" ? pixel(frame, cursor, fixed) : pixel(frame, fixed, cursor);
      if (colorDist(color, previous) > 36) {
        const length = cursor - last;
        if (length > 10) {
          lengths.push(length);
          cuts.push(last);
        }
        last = cursor;
        previous = color;
      }
    }
  }
  return { cuts, lengths };
}

function alignOrigin(cuts: number[], size: number, rough: number): number {
  const votes = new Map<number, number>();
  for (const cut of cuts) {
    const mod = ((cut % size) + size) % size;
    const key = Math.round(mod);
    votes.set(key, (votes.get(key) ?? 0) + 1);
  }
  let shift = 0;
  let bestVotes = -1;
  for (const [mod, count] of votes) {
    if (count <= bestVotes) continue;
    bestVotes = count;
    let next = mod - (((rough % size) + size) % size);
    if (next > size / 2) next -= size;
    if (next < -size / 2) next += size;
    shift = next;
  }
  return Math.max(0, Math.round(rough + shift));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function refine(frame: ImageData, box: BoardBox): BoardBox {
  let best = box;
  let bestScore = checkerScore(frame, box);
  for (let size = box.size - 2; size <= box.size + 2; size += 1) {
    if (size < 16) continue;
    for (let y = box.y - 4; y <= box.y + 4; y += 1) {
      for (let x = box.x - 4; x <= box.x + 4; x += 1) {
        if (x < 0 || y < 0 || x + size * 8 > frame.width || y + size * 8 > frame.height) continue;
        const score = checkerScore(frame, { x, y, size });
        if (score > bestScore) {
          bestScore = score;
          best = { x, y, size };
        }
      }
    }
  }
  return best;
}

function quickChecker(frame: ImageData, x: number, y: number, size: number): boolean {
  const a = edgeColor(frame, x, y, size);
  const b = edgeColor(frame, x + size, y, size);
  const c = edgeColor(frame, x, y + size, size);
  const d = edgeColor(frame, x + size, y + size, size);
  // Wood and marble boards vary inside a square, so same-color corners are allowed to differ.
  return colorDist(a, b) > 16 && colorDist(a, c) > 16 && colorDist(a, d) < 78 && colorDist(b, c) < 78;
}

function checkerScore(frame: ImageData, box: BoardBox): number {
  const colors: RGB[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      colors.push(edgeColor(frame, box.x + col * box.size, box.y + row * box.size, box.size));
    }
  }
  const light = average(colors.filter((_, index) => squareParity(index)));
  const dark = average(colors.filter((_, index) => !squareParity(index)));
  if (colorDist(light, dark) < 20) return 0;
  let matched = 0;
  colors.forEach((color, index) => {
    const even = squareParity(index);
    const same = colorDist(color, even ? light : dark);
    const other = colorDist(color, even ? dark : light);
    if (same <= other) matched += 1;
  });
  return matched;
}

function squareParity(index: number): boolean {
  const row = Math.floor(index / 8);
  const col = index % 8;
  return (row + col) % 2 === 0;
}

function readPieces(
  frame: ImageData,
  box: BoardBox,
  set: PieceSet,
  whiteAtBottom: boolean,
): { fen: string; score: number } | null {
  const grid: Array<Array<string | null>> = Array.from({ length: 8 }, () => Array(8).fill(null));
  let score = 0;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const originX = box.x + col * box.size;
      const originY = box.y + row * box.size;
      const piece = classifySquare(frame, originX, originY, box.size, set);
      score += piece.score;
      const rank = whiteAtBottom ? row : 7 - row;
      const file = whiteAtBottom ? col : 7 - col;
      let code = piece.code;
      if (code && code[1] === "p" && (rank === 0 || rank === 7)) {
        code = `${code[0]}q`;
      }
      grid[rank][file] = code;
    }
  }
  const clean = gridToPlacement(grid);
  if (!clean.includes("K") || !clean.includes("k")) return null;
  const turn = turnFromHighlights(frame, box, grid, whiteAtBottom);
  const fen = `${clean} ${turn} ${castlingFromPlacement(clean)} - 0 1`;
  return { fen, score };
}

function gridToPlacement(grid: Array<Array<string | null>>): string {
  return grid
    .map((rank) => {
      const glyphs = rank.map((code) => (code ? fenGlyph(code) : "1")).join("");
      return glyphs.replace(/1{2,}/g, (run) => String(run.length));
    })
    .join("/");
}

function fenGlyph(code: string): string {
  const glyph = code[1] ?? "p";
  return code[0] === "w" ? glyph.toUpperCase() : glyph;
}

function classifySquare(
  frame: ImageData,
  x: number,
  y: number,
  size: number,
  set: PieceSet,
): { code: string | null; score: number } {
  const background = edgeColor(frame, x, y, size);
  const foreground = squareForeground(frame, x, y, size, background);
  if (foreground < size * size * 0.045) return { code: null, score: 0 };
  let bestCode: string | null = null;
  let best = 0.22;
  for (const code of CODES) {
    const image = set.images[code];
    if (!image) continue;
    const template = templateOf(set.name, code, size, image);
    const iou = maskIou(frame, x, y, size, background, template);
    if (iou < 0.2) continue;
    const color = templateColorDistance(frame, x, y, size, template);
    const score = iou - color / 320;
    if (score > best) {
      best = score;
      bestCode = code;
    }
  }
  return { code: bestCode, score: bestCode ? 1 - best : 1 };
}

const templateCache = new Map<string, ImageData>();

function templateOf(setName: string, code: string, size: number, image: CanvasImageSource): ImageData {
  const key = `${setName}:${code}:${size}`;
  const cached = templateCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return new ImageData(size, size);
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size);
  templateCache.set(key, data);
  return data;
}

function squareForeground(frame: ImageData, x: number, y: number, size: number, background: RGB): number {
  let count = 0;
  const step = size > 80 ? 2 : 1;
  for (let py = 0; py < size; py += step) {
    for (let px = 0; px < size; px += step) {
      if (colorDist(pixel(frame, x + px, y + py), background) > 42) count += 1;
    }
  }
  return count * step * step;
}

function maskIou(
  frame: ImageData,
  x: number,
  y: number,
  size: number,
  background: RGB,
  template: ImageData,
): number {
  let intersection = 0;
  let union = 0;
  const step = size > 64 ? 2 : 1;
  for (let py = 0; py < size; py += step) {
    for (let px = 0; px < size; px += step) {
      const index = (py * size + px) * 4;
      const templateOn = (template.data[index + 3] ?? 0) > 120;
      const photoOn = colorDist(pixel(frame, x + px, y + py), background) > 42;
      if (templateOn || photoOn) union += 1;
      if (templateOn && photoOn) intersection += 1;
    }
  }
  return union ? intersection / union : 0;
}

function templateColorDistance(frame: ImageData, x: number, y: number, size: number, template: ImageData): number {
  let total = 0;
  let count = 0;
  const step = size > 64 ? 2 : 1;
  for (let py = 0; py < size; py += step) {
    for (let px = 0; px < size; px += step) {
      const index = (py * size + px) * 4;
      if ((template.data[index + 3] ?? 0) < 160) continue;
      const actual = pixel(frame, x + px, y + py);
      total += colorDist(actual, [template.data[index], template.data[index + 1], template.data[index + 2]]);
      count += 1;
    }
  }
  return count ? total / count : 255;
}

function turnFromHighlights(
  frame: ImageData,
  box: BoardBox,
  grid: Array<Array<string | null>>,
  whiteAtBottom: boolean,
): "w" | "b" {
  const highlighted: Array<{ row: number; col: number }> = [];
  const colors: RGB[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      colors.push(edgeColor(frame, box.x + col * box.size, box.y + row * box.size, box.size));
    }
  }
  const meanYellow = colors.reduce((sum, color) => sum + (color[0] + color[1]) / 2 - color[2], 0) / colors.length;
  colors.forEach((color, index) => {
    const yellow = (color[0] + color[1]) / 2 - color[2];
    if (yellow > meanYellow + 18) highlighted.push({ row: Math.floor(index / 8), col: index % 8 });
  });
  for (const spot of highlighted) {
    const rank = whiteAtBottom ? spot.row : 7 - spot.row;
    const file = whiteAtBottom ? spot.col : 7 - spot.col;
    const code = grid[rank]?.[file];
    if (code) return code[0] === "w" ? "b" : "w";
  }
  const placement = gridToPlacement(grid);
  if (placement === "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR") return "w";
  return "w";
}

function castlingFromPlacement(placement: string): string {
  const rows = placement.split("/").map(expandRank);
  if (rows.length !== 8) return "-";
  let rights = "";
  if (rows[7]?.[4] === "K" && rows[7]?.[7] === "R") rights += "K";
  if (rows[7]?.[4] === "K" && rows[7]?.[0] === "R") rights += "Q";
  if (rows[0]?.[4] === "k" && rows[0]?.[7] === "r") rights += "k";
  if (rows[0]?.[4] === "k" && rows[0]?.[0] === "r") rights += "q";
  return rights || "-";
}

function edgeColor(frame: ImageData, x: number, y: number, size: number): RGB {
  const points: Array<[number, number]> = [
    [x + size * 0.08, y + size * 0.08],
    [x + size * 0.92, y + size * 0.08],
    [x + size * 0.08, y + size * 0.92],
    [x + size * 0.92, y + size * 0.92],
  ];
  const samples = points.map(([px, py]) => pixel(frame, Math.round(px), Math.round(py)));
  samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  return samples[1] ?? samples[0];
}

function pixel(frame: ImageData, x: number, y: number): RGB {
  const clampedX = Math.max(0, Math.min(frame.width - 1, x));
  const clampedY = Math.max(0, Math.min(frame.height - 1, y));
  const index = (clampedY * frame.width + clampedX) * 4;
  return [frame.data[index], frame.data[index + 1], frame.data[index + 2]];
}

function average(colors: RGB[]): RGB {
  if (colors.length === 0) return [0, 0, 0];
  const sum = colors.reduce<RGB>((acc, color) => [acc[0] + color[0], acc[1] + color[1], acc[2] + color[2]], [0, 0, 0]);
  return [sum[0] / colors.length, sum[1] / colors.length, sum[2] / colors.length];
}

function colorDist(a: RGB, b: RGB): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function expandRank(rank: string): string {
  let squares = "";
  for (const char of rank) {
    const count = Number(char);
    squares += Number.isInteger(count) && count > 0 ? "1".repeat(count) : char;
  }
  return squares.padEnd(8, "1").slice(0, 8);
}

function compressRank(rank: string): string {
  return rank.replace(/1{2,}/g, (run) => String(run.length));
}

function pieceUrl(name: string, code: string): string {
  if (hostedWithoutServer) {
    return `https://images.chesscomfiles.com/chess-themes/pieces/${name}/150/${code}.png`;
  }
  return `/api/piece?set=${name}&code=${code}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load a Chess.com piece image."));
    image.src = src;
  });
}
