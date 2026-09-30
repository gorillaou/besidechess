import { Chess } from "chess.js";

const TCN_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?{~}(^)[_]@#$,./&-*++=";
const PIECE_CHARS = "qnrbkp";

export type ChessComGame = {
  id: string;
  url: string;
  kind: "daily" | "live";
  fen: string;
  turn: "w" | "b";
  white: string;
  black: string;
  rules: string;
  timeClass: string;
  rated: boolean;
  finished: boolean;
  yourTurn: boolean | null;
  you: "w" | "b" | null;
  opponent: string | null;
  moveBy: number | null;
  note: string | null;
};

export type ChessComProfile = {
  username: string;
  name: string | null;
  avatar: string | null;
  url: string;
};

const USER_AGENT = "Beside/1.0 (Chess.com study coach)";

export function parseChessComTarget(input: string): { kind: "daily" | "live" | "auto"; id: string } | null {
  const text = input.trim();
  const explicit = text.match(/chess\.com\/(?:game\/)?(live|daily)\/(\d+)/i);
  if (explicit?.[1] && explicit[2]) {
    return { kind: explicit[1].toLowerCase() === "daily" ? "daily" : "live", id: explicit[2] };
  }
  const bare = text.match(/chess\.com\/game\/(\d+)/i);
  if (bare?.[1]) return { kind: "auto", id: bare[1] };
  const play = text.match(/chess\.com\/play\/online(?:\/game)?\/(\d+)/i);
  if (play?.[1]) return { kind: "live", id: play[1] };
  if (/^\d+$/.test(text)) return { kind: "auto", id: text };
  return null;
}

export function usernameFromProfileUrl(url: string): string {
  const name = url.split("/").filter(Boolean).pop() ?? "";
  return decodeURIComponent(name).toLowerCase();
}

export function isUsername(value: string): boolean {
  return /^[A-Za-z0-9_]{2,25}$/.test(value.trim());
}

export function decodeTcn(tcn: string, startFen?: string): string {
  const chess = startFen ? new Chess(startFen) : new Chess();
  for (let index = 0; index < tcn.length; index += 2) {
    const pair = tcn.slice(index, index + 2);
    const move = decodeTcnPair(pair);
    if (move.drop) {
      throw new Error("Beside reads standard Chess.com games. This one uses piece drops.");
    }
    if (!move.from || !playPair(chess, move.from, move.to, move.promotion)) {
      throw new Error("Chess.com sent a move Beside could not read.");
    }
  }
  return chess.fen();
}

export async function fetchProfile(username: string): Promise<ChessComProfile> {
  const data = await chessComJson(`https://api.chess.com/pub/player/${encodeURIComponent(username)}`);
  if (!data || typeof data.username !== "string") {
    throw new Error("That Chess.com username was not found.");
  }
  return {
    username: data.username,
    name: typeof data.name === "string" ? data.name : null,
    avatar: typeof data.avatar === "string" ? data.avatar : null,
    url: typeof data.url === "string" ? data.url : `https://www.chess.com/member/${data.username}`,
  };
}

export async function fetchCurrentGames(username: string): Promise<ChessComGame[]> {
  const data = await chessComJson(
    `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games`,
  );
  const games = Array.isArray(data.games) ? data.games : [];
  const you = username.toLowerCase();
  return games
    .map((game) => gameFromPublic(game, you))
    .filter((game): game is ChessComGame => game !== null)
    .sort((a, b) => Number(b.yourTurn) - Number(a.yourTurn));
}

export async function fetchGame(kind: "daily" | "live" | "auto", id: string, you?: string): Promise<ChessComGame> {
  if (!/^\d+$/.test(id)) throw new Error("That Chess.com link is missing a game number.");
  const viewer = you?.toLowerCase();
  if (kind !== "daily") {
    const live = await fetchLiveFromPlay(id, viewer);
    if (live) return live;
  }
  if (kind !== "daily") {
    const archived = await chessComJsonAllowMissing(`https://www.chess.com/callback/live/game/${id}`);
    if (archived) return gameFromCallback(archived, "live", id, viewer);
  }
  if (kind !== "live") {
    const daily = await chessComJsonAllowMissing(`https://www.chess.com/callback/daily/game/${id}`);
    if (daily) return gameFromCallback(daily, "daily", id, viewer);
  }
  throw new Error(
    "Chess.com has not published that game yet. If it just started, leave the link in and Beside will keep checking.",
  );
}

async function fetchLiveFromPlay(id: string, you?: string): Promise<ChessComGame | null> {
  const meta = await chessComJsonAllowMissing(`https://www.chess.com/service/play/games/${id}`);
  if (!meta || typeof meta.id !== "string") return null;
  const variant = typeof meta.variant === "string" ? meta.variant : "chess";
  if (variant !== "chess") {
    throw new Error("Beside reads standard Chess.com games. This one is a different variant.");
  }
  const transports = asRecord(meta.transports);
  const http = asRecord(transports?.http);
  const httpPath = typeof http?.url === "string" ? http.url : `/service/play-2/chess/games/${meta.id}`;
  const state = await chessComJsonAllowMissing(`https://www.chess.com${httpPath}`);
  if (!state) return null;
  const details = Array.isArray(meta.playersDetails) ? meta.playersDetails : [];
  const white = usernameFromDetails(details[0]);
  const black = usernameFromDetails(details[1]);
  const moves = tcnFromPlayMoves(state.moves);
  let fen: string;
  try {
    fen = moves ? decodeTcn(moves) : new Chess().fen();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Beside")) throw error;
    throw new Error("Beside could not read this Chess.com game. Standard chess games work.");
  }
  const turn = new Chess(fen).turn();
  const finished = typeof state.finishedAt === "string" || typeof meta.finishedAt === "string";
  const yourColor = you && white.toLowerCase() === you ? "w" : you && black.toLowerCase() === you ? "b" : null;
  return {
    id,
    url: `https://www.chess.com/game/live/${id}`,
    kind: "live",
    fen,
    turn,
    white,
    black,
    rules: variant,
    timeClass: typeof meta.timeclass === "string" ? meta.timeclass : "live",
    rated: Boolean(meta.rated),
    finished,
    you: yourColor,
    yourTurn: yourColor ? yourColor === turn && !finished : null,
    opponent: yourColor === "w" ? black : yourColor === "b" ? white : null,
    moveBy: null,
    note: finished ? resultNote(state.results, white, black) : null,
  };
}

function gameFromPublic(game: Record<string, unknown>, you: string): ChessComGame | null {
  if (typeof game.fen !== "string" || typeof game.url !== "string") return null;
  if (!isStandardFen(game.fen)) return null;
  const white = typeof game.white === "string" ? usernameFromProfileUrl(game.white) : "";
  const black = typeof game.black === "string" ? usernameFromProfileUrl(game.black) : "";
  const idMatch = game.url.match(/(\d+)\/?$/);
  const id = idMatch?.[1] ?? game.url;
  const yourColor = white === you ? "w" : black === you ? "b" : null;
  const turn = game.turn === "black" ? "b" : "w";
  return {
    id,
    url: game.url,
    kind: "daily",
    fen: game.fen,
    turn,
    white,
    black,
    rules: typeof game.rules === "string" ? game.rules : "chess",
    timeClass: typeof game.time_class === "string" ? game.time_class : "daily",
    rated: Boolean(game.rated),
    finished: false,
    you: yourColor,
    yourTurn: yourColor ? yourColor === turn : null,
    opponent: yourColor === "w" ? black : yourColor === "b" ? white : null,
    moveBy: typeof game.move_by === "number" ? game.move_by : null,
    note: null,
  };
}

function gameFromCallback(
  data: Record<string, unknown>,
  kind: "daily" | "live",
  id: string,
  you?: string,
): ChessComGame {
  const game = asRecord(data.game);
  if (!game) throw new Error("Chess.com did not return that game.");
  const headers = asRecord(game.pgnHeaders) ?? {};
  const players = asRecord(data.players);
  const sides = playersFromCallback(players);
  const startFen = typeof headers.FEN === "string" && headers.SetUp === "1" ? headers.FEN : undefined;
  if (startFen && !isStandardFen(startFen)) {
    throw new Error("Beside reads standard Chess.com games. This one starts from a variant position.");
  }
  const moveList = typeof game.moveList === "string" ? game.moveList : "";
  let fen: string;
  try {
    fen = moveList ? decodeTcn(moveList, startFen) : startFen ?? new Chess().fen();
  } catch {
    throw new Error("Beside could not read this Chess.com game. Standard chess games work.");
  }
  const turn = new Chess(fen).turn();
  const white = sides.white || stringField(headers.White);
  const black = sides.black || stringField(headers.Black);
  const yourColor = you && white.toLowerCase() === you ? "w" : you && black.toLowerCase() === you ? "b" : null;
  return {
    id,
    url: `https://www.chess.com/game/${kind}/${id}`,
    kind,
    fen,
    turn,
    white,
    black,
    rules: typeof game.type === "string" ? game.type : "chess",
    timeClass: kind === "daily" ? "daily" : "live",
    rated: Boolean(game.isRated),
    finished: Boolean(game.isFinished),
    you: yourColor,
    yourTurn: yourColor ? yourColor === turn && !game.isFinished : null,
    opponent: yourColor === "w" ? black : yourColor === "b" ? white : null,
    moveBy: null,
    note: typeof game.resultMessage === "string" ? game.resultMessage : null,
  };
}

function playersFromCallback(players: Record<string, unknown> | null): { white: string; black: string } {
  const result = { white: "", black: "" };
  if (!players) return result;
  for (const side of [players.top, players.bottom, players.white, players.black]) {
    const record = asRecord(side);
    if (!record) continue;
    const name = stringField(record.username) || stringField(record.name);
    const color = stringField(record.color).toLowerCase();
    if (color === "white") result.white = name;
    if (color === "black") result.black = name;
  }
  return result;
}

function decodeTcnPair(pair: string): { from?: string; to: string; promotion?: string; drop?: string } {
  const fromIndex = TCN_CHARS.indexOf(pair[0] ?? "");
  let toIndex = TCN_CHARS.indexOf(pair[1] ?? "");
  if (fromIndex < 0 || toIndex < 0) {
    throw new Error("Chess.com sent a move Beside could not read.");
  }
  let promotion: string | undefined;
  if (toIndex > 63) {
    promotion = PIECE_CHARS[Math.floor((toIndex - 64) / 3)];
    toIndex = fromIndex + (fromIndex < 16 ? -8 : 8) + ((toIndex - 1) % 3) - 1;
  }
  if (fromIndex > 75) {
    return { drop: PIECE_CHARS[fromIndex - 79], to: squareFromIndex(toIndex), promotion };
  }
  return { from: squareFromIndex(fromIndex), to: squareFromIndex(toIndex), promotion };
}

function playPair(chess: Chess, from: string, to: string, promotion?: string): boolean {
  const pieces: Array<"q" | "r" | "b" | "n" | undefined> =
    promotion === "q" || promotion === "r" || promotion === "b" || promotion === "n"
      ? [promotion]
      : [undefined, "q", "r", "b", "n"];
  for (const piece of pieces) {
    try {
      chess.move(piece ? { from, to, promotion: piece } : { from, to });
      return true;
    } catch {
      // try the next promotion piece
    }
  }
  return false;
}

function squareFromIndex(index: number): string {
  const file = index % 8;
  const rank = Math.floor(index / 8);
  return `${"abcdefgh"[file]}${rank + 1}`;
}

function tcnFromPlayMoves(moves: unknown): string {
  if (!Array.isArray(moves)) return "";
  return moves
    .map((move) => (Array.isArray(move) && typeof move[0] === "string" ? move[0] : ""))
    .join("");
}

function usernameFromDetails(value: unknown): string {
  const record = asRecord(value);
  return record && typeof record.username === "string" ? record.username : "";
}

function resultNote(results: unknown, white: string, black: string): string | null {
  if (!Array.isArray(results) || results.length < 2) return null;
  const whiteResult = typeof results[0] === "string" ? results[0] : "";
  const blackResult = typeof results[1] === "string" ? results[1] : "";
  const winner = whiteResult === "win" ? white : blackResult === "win" ? black : null;
  if (!winner) {
    if (["agreed", "stalemate", "repetition", "insufficient", "50move"].includes(whiteResult)) return "Draw";
    return null;
  }
  const reason = winner === white ? blackResult : whiteResult;
  const how =
    reason === "resigned"
      ? "resignation"
      : reason === "timeout" || reason === "time"
        ? "timeout"
        : reason === "checkmated"
          ? "checkmate"
          : reason === "abandoned"
            ? "abandonment"
            : "";
  return how ? `${winner} won by ${how}` : `${winner} won`;
}

function isStandardFen(fen: string): boolean {
  try {
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

async function chessComJsonAllowMissing(url: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  if (response.status === 404 || response.status === 204) return null;
  const data = await readChessComJson(response);
  return data;
}

async function chessComJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  return readChessComJson(response);
}

async function readChessComJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : `Chess.com returned ${response.status}.`;
    if (response.status === 404) throw new Error(message.includes("not found") ? "That Chess.com player or game was not found." : message);
    throw new Error(message);
  }
  if (!data || typeof data !== "object") throw new Error("Chess.com sent a response Beside could not read.");
  return data as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}
