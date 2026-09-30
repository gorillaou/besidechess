import { fetchCurrentGames, fetchGame, fetchProfile, isUsername, parseChessComTarget } from "@/lib/chesscom";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const game = searchParams.get("game")?.trim() ?? "";
  const username = searchParams.get("username")?.trim() ?? "";

  try {
    if (game) {
      const target = parseChessComTarget(game);
      if (!target) {
        return Response.json(
          { error: "Paste a Chess.com game link, like chess.com/game/live/123 or chess.com/game/123." },
          { status: 400 },
        );
      }
      const loaded = await fetchGame(target.kind, target.id, username || undefined);
      return Response.json({ game: loaded });
    }

    if (!isUsername(username)) {
      return Response.json(
        { error: "Enter your Chess.com username. Letters, numbers, and underscores only." },
        { status: 400 },
      );
    }

    const [profile, games] = await Promise.all([
      fetchProfile(username),
      fetchCurrentGames(username),
    ]);
    return Response.json({ profile, games });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chess.com could not be reached.";
    const status = message.includes("not found") || message.includes("keep checking")
      ? 404
      : message.startsWith("Beside") || message.includes("game number")
        ? 400
        : 502;
    return Response.json({ error: message }, { status });
  }
}
