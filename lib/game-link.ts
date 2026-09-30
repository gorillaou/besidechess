const GAME_LINK =
  /chess\.com\/(?:game\/(?:live|daily)\/|game\/|play\/online(?:\/game)?\/)(\d{5,})/i;

export function extractChessComGameLink(raw: string): string | null {
  const compact = raw
    .replace(/[\s\u200b\u00a0]+/g, "")
    .replace(/chess[,.]?com/gi, "chess.com")
    .replace(/1ive/gi, "live")
    .replace(/l1ve/gi, "live")
    .replace(/Iive/g, "live")
    .replace(/g4me/gi, "game")
    .replace(/da1ly/gi, "daily");
  const match = compact.match(GAME_LINK);
  if (!match?.[1]) return null;
  const id = match[1];
  const path = match[0].slice("chess.com/".length);
  if (path.toLowerCase().startsWith("play/")) return `https://www.chess.com/play/online/${id}`;
  if (/game\/daily\//i.test(path)) return `https://www.chess.com/game/daily/${id}`;
  if (/game\/live\//i.test(path)) return `https://www.chess.com/game/live/${id}`;
  return `https://www.chess.com/game/${id}`;
}

export function extractChessComPlayMode(raw: string): "bot" | "coach" | null {
  const compact = raw
    .replace(/[\s\u200b\u00a0]+/g, "")
    .toLowerCase()
    .replace(/c0mputer/g, "computer")
    .replace(/c0ach/g, "coach");
  if (compact.includes("chess.com/play/coach")) return "coach";
  if (compact.includes("chess.com/play/computer") || compact.includes("chess.com/play/bot")) return "bot";
  return null;
}
