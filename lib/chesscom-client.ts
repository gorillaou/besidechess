import { fetchCurrentGames, fetchProfile, type ChessComGame, type ChessComProfile } from "@/lib/chesscom";
import { hostedWithoutServer } from "@/lib/base-path";

export async function loadPlayer(username: string): Promise<{ profile: ChessComProfile; games: ChessComGame[] }> {
  if (hostedWithoutServer) {
    const [profile, games] = await Promise.all([fetchProfile(username), fetchCurrentGames(username)]);
    return { profile, games };
  }
  const response = await fetch(`/api/chesscom?username=${encodeURIComponent(username)}`);
  const body = (await response.json()) as {
    profile?: ChessComProfile;
    games?: ChessComGame[];
    error?: string;
  };
  if (!response.ok || !body.profile) {
    throw new Error(body.error ?? "Chess.com could not be reached.");
  }
  return { profile: body.profile, games: body.games ?? [] };
}

export async function loadWatchedGame(gameUrl: string, username: string): Promise<ChessComGame> {
  if (hostedWithoutServer) {
    throw new Error(
      "Live game links cannot be read on GitHub Pages, because Chess.com does not share them with other websites. Share the Chess.com window and Beside reads the board.",
    );
  }
  const response = await fetch(
    `/api/chesscom?game=${encodeURIComponent(gameUrl)}&username=${encodeURIComponent(username)}`,
  );
  const body = (await response.json()) as { game?: ChessComGame; error?: string };
  if (!response.ok || !body.game) {
    throw new Error(body.error ?? "Chess.com could not be reached.");
  }
  return body.game;
}
