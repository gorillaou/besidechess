import {
  Chess,
  validateFen,
  type Color,
  type Move,
  type PieceSymbol,
  type Square,
} from "chess.js";

export const START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type EngineLine = {
  multipv: number;
  depth: number;
  cp: number | null;
  mate: number | null;
  pv: string[];
};

const PIECE_NAME: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

export type DraftPiece = { color: Color; type: PieceSymbol };
export type Draft = Record<string, DraftPiece>;

export type CastleFlags = { K: boolean; Q: boolean; k: boolean; q: boolean };

export function parseInfo(line: string): EngineLine | null {
  if (!line.includes(" pv ") || !line.includes(" score ")) return null;
  if (line.includes(" currmove ")) return null;

  const depth = Number(line.match(/\bdepth (\d+)/)?.[1] ?? 0);
  const multipv = Number(line.match(/\bmultipv (\d+)/)?.[1] ?? 1);
  const mateMatch = line.match(/\bscore mate (-?\d+)/);
  const cpMatch = line.match(/\bscore cp (-?\d+)/);
  const pv = line.split(" pv ")[1]?.trim().split(/\s+/) ?? [];
  const first = pv[0];
  if (!first || first.length < 4 || first === "pv") return null;

  return {
    depth,
    multipv,
    mate: mateMatch ? Number(mateMatch[1]) : null,
    cp: cpMatch ? Number(cpMatch[1]) : null,
    pv,
  };
}

export function moveFromUci(fen: string, uci: string): Move | null {
  if (uci.length < 4) return null;
  try {
    const chess = new Chess(fen);
    return chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
  } catch {
    return null;
  }
}

export function pvToSans(fen: string, pv: string[]): string[] {
  const chess = new Chess(fen);
  const sans: string[] = [];
  for (const uci of pv) {
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4],
      });
      sans.push(move.san);
    } catch {
      break;
    }
  }
  return sans;
}

export function headline(move: Move): string {
  const check = move.san.includes("#")
    ? ", checkmate"
    : move.san.includes("+")
      ? ", check"
      : "";

  if (move.isKingsideCastle()) return `Castle kingside${check}`;
  if (move.isQueensideCastle()) return `Castle queenside${check}`;

  const title = titleCase(PIECE_NAME[move.piece]);
  if (move.isPromotion()) {
    const promo = PIECE_NAME[move.promotion ?? "q"];
    if (move.isCapture()) {
      return `${title} takes on ${move.to} and becomes a ${promo}${check}`;
    }
    return `Pawn to ${move.to} and becomes a ${promo}${check}`;
  }
  if (move.isCapture()) return `${title} takes on ${move.to}${check}`;
  return `${title} to ${move.to}${check}`;
}

export function describeMove(move: Move): string {
  const check = move.san.includes("#")
    ? " That is checkmate."
    : move.san.includes("+")
      ? " It gives check."
      : "";

  if (move.isKingsideCastle()) {
    return `Castle kingside. The king steps toward the corner and the rook slides to the center.${check}`;
  }
  if (move.isQueensideCastle()) {
    return `Castle queenside. The king leaves the middle and the rook joins from the other wing.${check}`;
  }

  const name = PIECE_NAME[move.piece];
  if (move.isPromotion()) {
    const promo = PIECE_NAME[move.promotion ?? "q"];
    const action = move.isCapture()
      ? `Take on ${move.to} with the pawn and promote to a ${promo}.`
      : `Advance the pawn to ${move.to} and promote to a ${promo}.`;
    return action + check;
  }
  if (move.isCapture()) {
    const victim = PIECE_NAME[move.captured ?? "p"];
    return `Take the ${victim} on ${move.to} with the ${name}.${check}`;
  }
  if (
    (move.piece === "n" || move.piece === "b") &&
    (move.from[1] === "1" || move.from[1] === "8")
  ) {
    return `Develop the ${name} from ${move.from} to ${move.to}.${check}`;
  }
  if (
    move.piece === "p" &&
    Math.abs(Number(move.to[1]) - Number(move.from[1])) === 2
  ) {
    return `Push the ${move.from[0]}-pawn two squares to ${move.to} and take space.${check}`;
  }
  if (move.piece === "p") {
    return `Advance the pawn from ${move.from} to ${move.to}.${check}`;
  }
  return `Move the ${name} from ${move.from} to ${move.to}.${check}`;
}

export function forSpeech(text: string): string {
  return text
    .replace(/\b([a-h])([1-8])\b/g, "$1 $2")
    .replace(/×/g, " takes ");
}

export function sideName(color: Color): string {
  return color === "w" ? "White" : "Black";
}

export function whiteScore(
  cp: number | null,
  mate: number | null,
  turn: Color,
): { cp: number | null; mate: number | null } {
  if (mate != null) {
    return { cp: null, mate: turn === "w" ? mate : -mate };
  }
  if (cp == null) return { cp: null, mate: null };
  return { cp: turn === "w" ? cp : -cp, mate: null };
}

export function formatEval(
  cp: number | null,
  mate: number | null,
  turn: Color,
): string {
  const white = whiteScore(cp, mate, turn);
  if (white.mate != null) {
    if (white.mate > 0) return `+M${white.mate}`;
    if (white.mate < 0) return `-M${-white.mate}`;
  }
  if (white.cp == null) return "…";
  const pawns = white.cp / 100;
  const sign = pawns > 0 ? "+" : "";
  return `${sign}${pawns.toFixed(2)}`;
}

export function whitePercent(
  cp: number | null,
  mate: number | null,
  turn: Color,
): number {
  const white = whiteScore(cp, mate, turn);
  if (white.mate != null) return white.mate > 0 ? 100 : white.mate < 0 ? 0 : 50;
  if (white.cp == null) return 50;
  const pawns = Math.max(-8, Math.min(8, white.cp / 100));
  return 50 + (pawns / 8) * 50;
}

export function evalSentence(
  cp: number | null,
  mate: number | null,
  turn: Color,
): string {
  const white = whiteScore(cp, mate, turn);
  if (white.mate != null) {
    if (white.mate > 0) return `White has a forced mate in ${white.mate}.`;
    if (white.mate < 0) return `Black has a forced mate in ${-white.mate}.`;
  }
  if (white.cp == null) return "The engine is still judging the position.";
  const pawns = white.cp / 100;
  const side = pawns >= 0 ? "White" : "Black";
  const abs = Math.abs(pawns);
  if (abs < 0.2) return "The position is about even.";
  if (abs < 0.7) return `${side} is a little better.`;
  if (abs < 1.5) return `${side} has a clear edge.`;
  if (abs < 3) return `${side} is winning.`;
  return `${side} is completely winning.`;
}

export function resultText(chess: Chess): string | null {
  if (!chess.isGameOver()) return null;
  if (chess.isCheckmate()) {
    return chess.turn() === "w"
      ? "Checkmate. Black wins."
      : "Checkmate. White wins.";
  }
  if (chess.isStalemate()) return "Stalemate. The game is drawn.";
  if (chess.isThreefoldRepetition()) return "Draw by threefold repetition.";
  if (chess.isDrawByFiftyMoves()) return "Draw by the fifty-move rule.";
  if (chess.isInsufficientMaterial()) return "Draw by insufficient material.";
  return "The game is drawn.";
}

export function explainFenError(message: string): string {
  if (message.includes("missing") && message.includes("king")) {
    return "Both sides need a king on the board.";
  }
  if (message.includes("too many") && message.includes("king")) {
    return "Each side can have only one king.";
  }
  if (message.includes("edge rows")) {
    return "Pawns can't sit on the first or last rank. Move them off or promote them.";
  }
  if (message.includes("side-to-move")) {
    return "Say whose turn it is, white or black.";
  }
  return "That position isn't legal. Check the kings, the pawns, and whose turn it is.";
}

export function positionProblem(fen: string): string | null {
  const valid = validateFen(fen);
  if (!valid.ok) return explainFenError(valid.error ?? "Invalid FEN");
  try {
    const chess = new Chess(fen);
    const opponent: Color = chess.turn() === "w" ? "b" : "w";
    const king = chess.findPiece({ type: "k", color: opponent })[0];
    if (king && chess.isAttacked(king, chess.turn())) {
      return "The other king is already in check. That can't be the position before this side moves.";
    }
    return null;
  } catch (error) {
    return error instanceof Error
      ? explainFenError(error.message)
      : "That position isn't legal.";
  }
}

export function boardToDraft(chess: Chess): Draft {
  const draft: Draft = {};
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) continue;
      draft[piece.square] = { color: piece.color, type: piece.type };
    }
  }
  return draft;
}

export function draftToFen(
  draft: Draft,
  turn: Color,
  flags: CastleFlags,
): string {
  const ranks: string[] = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    let empty = 0;
    let row = "";
    for (const file of "abcdefgh") {
      const piece = draft[`${file}${rank}`];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty) {
        row += empty;
        empty = 0;
      }
      const letter = piece.type;
      row += piece.color === "w" ? letter.toUpperCase() : letter;
    }
    if (empty) row += empty;
    ranks.push(row);
  }

  const castling = saneCastling(draft, flags);
  return `${ranks.join("/")} ${turn} ${castling} - 0 1`;
}

export function saneCastling(draft: Draft, flags: CastleFlags): string {
  let castling = "";
  const at = (square: string, color: Color, type: PieceSymbol) =>
    draft[square]?.color === color && draft[square]?.type === type;

  if (flags.K && at("e1", "w", "k") && at("h1", "w", "r")) castling += "K";
  if (flags.Q && at("e1", "w", "k") && at("a1", "w", "r")) castling += "Q";
  if (flags.k && at("e8", "b", "k") && at("h8", "b", "r")) castling += "k";
  if (flags.q && at("e8", "b", "k") && at("a8", "b", "r")) castling += "q";
  return castling || "-";
}

export function castleFlagsFromChess(chess: Chess): CastleFlags {
  const white = chess.getCastlingRights("w");
  const black = chess.getCastlingRights("b");
  return {
    K: white.k,
    Q: white.q,
    k: black.k,
    q: black.q,
  };
}

export function historyRows(
  sans: string[],
  startMove: number,
  startTurn: Color,
): { n: number; white?: string; black?: string }[] {
  const rows: { n: number; white?: string; black?: string }[] = [];
  let index = 0;
  let moveNumber = startMove;

  if (startTurn === "b" && sans.length) {
    rows.push({ n: moveNumber, white: "…", black: sans[0] });
    index = 1;
    moveNumber += 1;
  }

  for (; index < sans.length; index += 2) {
    rows.push({
      n: moveNumber,
      white: sans[index],
      black: sans[index + 1],
    });
    moveNumber += 1;
  }

  return rows;
}

export function isSquare(value: string): value is Square {
  return /^[a-h][1-8]$/.test(value);
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
