"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Chess } from "chess.js";
import { Download, ExternalLink, LoaderCircle, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ScreenStage } from "@/components/screen-stage";
import {
  describeMove,
  evalSentence,
  forSpeech,
  formatEval,
  headline,
  moveFromUci,
  positionProblem,
  pvToSans,
  resultText,
  sideName,
  whitePercent,
} from "@/lib/coach";
import { asset } from "@/lib/base-path";
import { rotateFen180 } from "@/lib/board-vision";
import { extractChessComPlayMode } from "@/lib/game-link";
import type { ChessComGame, ChessComProfile } from "@/lib/chesscom";
import { loadPlayer, loadWatchedGame } from "@/lib/chesscom-client";
import { silence, speak } from "@/lib/speech";
import { useStockfish } from "@/lib/use-stockfish";

const Chessboard = dynamic(
  () => import("react-chessboard").then((mod) => mod.Chessboard),
  {
    ssr: false,
    loading: () => (
      <div className="aspect-square w-full animate-pulse rounded-xl bg-[#3f6b54]/30" />
    ),
  },
);

const USERNAME_EVENT = "beside-chesscom-user";

export function ChessComApp() {
  const savedUsername = useStoredUsername();
  const voice = useVoicePreference();
  const lastSpoken = useRef("");
  const [draftUser, setDraftUser] = useState("");
  const [seenUsername, setSeenUsername] = useState(savedUsername);
  if (savedUsername !== seenUsername) {
    setSeenUsername(savedUsername);
    setDraftUser(savedUsername);
  }
  const [draftLink, setDraftLink] = useState("");
  const [profile, setProfile] = useState<ChessComProfile | null>(null);
  const [games, setGames] = useState<ChessComGame[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linked, setLinked] = useState<ChessComGame | null>(null);
  const [screenGame, setScreenGame] = useState<ChessComGame | null>(null);
  const [watchUrl, setWatchUrl] = useState<string | null>(null);
  const [watchNonce, setWatchNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [speechLine, setSpeechLine] = useState("");
  const [secret, setSecret] = useState("");
  const [codeUnlocked, setCodeUnlocked] = useState(false);
  const [secretError, setSecretError] = useState<string | null>(null);

  const active = screenGame ?? (watchUrl
    ? linked
    : (games.find((game) => game.id === selectedId) ?? games[0] ?? null));
  const problem = active ? positionProblem(active.fen) : null;
  const analysisFen = active && !problem && !active.finished ? active.fen : null;
  const { status, lines } = useStockfish(analysisFen, 14, 0);
  const position = useMemo(() => {
    if (!active || problem) return null;
    try {
      return new Chess(active.fen);
    } catch {
      return null;
    }
  }, [active, problem]);

  const turn = position?.turn() ?? "w";
  const best = lines[0];
  const bestMove = active && best ? moveFromUci(active.fen, best.pv[0] ?? "") : null;
  const bestSans = active && best ? pvToSans(active.fen, best.pv) : [];
  const call = bestMove ? headline(bestMove) : null;
  const reason = bestMove ? describeMove(bestMove) : null;
  const squares = bestMove ? `${bestMove.from} → ${bestMove.to}` : null;
  const settled = (best?.depth ?? 0) >= 10;
  const yourTurn = active?.yourTurn === true;
  const waiting = active?.yourTurn === false;
  const boardOrientation = screenGame
    ? flipped
      ? "black"
      : "white"
    : resolveOrientation(active?.you ?? null, flipped);
  const youName = profile?.username || savedUsername || "You";

  useEffect(() => {
    if (!savedUsername) return;
    let cancelled = false;
    async function load(initial: boolean) {
      if (initial) setLoading(true);
      else setRefreshing(true);
      try {
        const body = await loadPlayer(savedUsername);
        if (cancelled) return;
        setError(null);
        setProfile(body.profile);
        setGames(body.games);
        setSelectedId((current) => {
          const list = body.games;
          if (current && list.some((game) => game.id === current)) return current;
          return list.find((game) => game.yourTurn)?.id ?? list[0]?.id ?? null;
        });
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Chess.com could not be reached.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    void load(true);
    const timer = window.setInterval(() => void load(false), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [savedUsername]);

  useEffect(() => {
    if (!watchUrl) return;
    const gameUrl = watchUrl;
    let cancelled = false;
    async function refresh() {
      try {
        const game = await loadWatchedGame(gameUrl, savedUsername);
        if (cancelled) return;
        setLinkError(null);
        setLinked(game);
      } catch (caught) {
        if (!cancelled) {
          setLinkError(caught instanceof Error ? caught.message : "Chess.com could not be reached.");
        }
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [savedUsername, watchNonce, watchUrl]);

  useEffect(() => {
    if (!voice || !speechLine) return;
    if (speechLine === lastSpoken.current) return;
    lastSpoken.current = speechLine;
    speak(speechLine);
  }, [voice, speechLine]);

  useEffect(() => {
    if (!call || !reason || !settled || active?.finished) return;
    const place =
      active?.timeClass === "coach" ? "Against the coach" : active?.timeClass === "bot" ? "Against the bot" : "On Chess.com";
    const text = forSpeech(
      waiting
        ? `${active?.opponent ?? "Opponent"} to move. ${call}. ${reason}`
        : `${place}, ${call}. ${reason}`,
    );
    const timer = window.setTimeout(() => setSpeechLine(text), 450);
    return () => window.clearTimeout(timer);
  }, [active?.finished, active?.opponent, active?.timeClass, call, reason, settled, waiting]);

  useEffect(() => () => silence(), []);

  function saveUsername(value: string) {
    const next = value.trim();
    window.localStorage.setItem(USERNAME_EVENT, next);
    window.dispatchEvent(new Event(USERNAME_EVENT));
  }

  function followFromScreen(url: string) {
    setDraftLink(url);
    setScreenGame(null);
    if (url === watchUrl) return;
    setLinkError(null);
    setFlipped(false);
    setWatchUrl(url);
    setWatchNonce((value) => value + 1);
  }

  function followFromBoard(fen: string, mode: "bot" | "coach", detected: boolean) {
    if (watchUrl && !detected) return;
    const whiteAtBottom = watchUrl ? true : !flipped;
    if (watchUrl) setFlipped(false);
    setWatchUrl(null);
    setLinked(null);
    setLinkError(null);
    const next = screenGameFromFen(fen, mode, whiteAtBottom, youName);
    if (!next) return;
    setScreenGame((current) => (current?.fen === next.fen && current.timeClass === next.timeClass ? current : next));
  }

  function toggleFlip() {
    const nextFlipped = !flipped;
    setFlipped(nextFlipped);
    setScreenGame((current) => {
      if (!current) return current;
      const mode = current.timeClass === "coach" ? "coach" : "bot";
      return screenGameFromFen(rotateFen180(current.fen), mode, !nextFlipped, youName) ?? current;
    });
  }

  function followLink(raw: string) {
    const next = raw.trim();
    if (!next) {
      setLinkError("Paste the Chess.com game link from the address bar.");
      return;
    }
    const mode = extractChessComPlayMode(next);
    if (mode) {
      setLinkError(
        mode === "coach"
          ? "Coach games are not a public link. Share the Chess.com window and Beside reads the board."
          : "Bot games are not a public link. Share the Chess.com window and Beside reads the board.",
      );
      return;
    }
    setLinkError(null);
    setFlipped(false);
    setLinked(null);
    setScreenGame(null);
    setWatchUrl(next);
    setWatchNonce((value) => value + 1);
  }

  function submitSecret(event: FormEvent) {
    event.preventDefault();
    if (secret.trim() !== "Brayden1234") {
      setCodeUnlocked(false);
      setSecretError("That code is not right.");
      return;
    }
    setSecretError(null);
    setCodeUnlocked(true);
  }

  function toggleVoice(on: boolean) {
    window.localStorage.setItem("beside-voice", on ? "on" : "off");
    window.dispatchEvent(new Event("beside-voice"));
    if (!on) {
      silence();
      return;
    }
    if (call && reason) {
      const text = forSpeech(`On Chess.com, ${call}. ${reason}`);
      lastSpoken.current = text;
      setSpeechLine(text);
      speak(text);
    }
  }

  const bottomIsWhite = boardOrientation === "white";
  const percent = best ? whitePercent(best.cp, best.mate, turn) : 50;
  const bottomPercent = bottomIsWhite ? percent : 100 - percent;
  const overText = position ? resultText(position) : null;

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-4 py-5 sm:px-6 sm:py-7">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <p className="text-xs font-medium tracking-[0.22em] text-primary uppercase">
            Beside · Chess.com
          </p>
          <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
            The move, from your real game.
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
            Beside reads the game on Chess.com and tells you what to play there. The board here is that same position, not a separate game.
          </p>
        </div>
        {profile ? (
          <a
            href={profile.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
          >
            {profile.avatar ? (
              <Image
                src={profile.avatar}
                alt=""
                width={40}
                height={40}
                className="size-10 rounded-full object-cover"
              />
            ) : null}
            <span>
              <span className="block text-sm font-medium">{profile.name ?? profile.username}</span>
              <span className="block text-xs text-muted-foreground">@{profile.username} on Chess.com</span>
            </span>
          </a>
        ) : null}
      </header>

      <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:grid-cols-[1fr_auto_1.4fr_auto] md:items-end">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
          saveUsername(draftUser);
          setLinked(null);
          setWatchUrl(null);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="username">Chess.com username</Label>
            <Input
              id="username"
              value={draftUser}
              placeholder="your username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setDraftUser(event.target.value)}
            />
          </div>
          <Button type="submit" className="h-8" disabled={loading}>
            {loading ? "Checking Chess.com…" : "Load my games"}
          </Button>
        </form>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void followLink(draftLink);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="game-link">Or the game link from the address bar</Label>
            <Input
              id="game-link"
              value={draftLink}
              placeholder="https://www.chess.com/game/live/…"
              onChange={(event) => setDraftLink(event.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" className="h-8">
            Follow this game
          </Button>
        </form>
      </div>
      {error ? <p className="text-sm text-[#f0b4a4]" role="alert">{error}</p> : null}
      {linkError ? <p className="text-sm text-[#f0b4a4]" role="alert">{linkError}</p> : null}

      <form onSubmit={submitSecret} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="secret-code">Secret Code</Label>
          <Input
            id="secret-code"
            value={secret}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setSecret(event.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary" className="h-8">
          Check code
        </Button>
        {codeUnlocked ? (
          <Button asChild className="h-8">
            <a href={asset("/beside-website.zip")} download="beside-website.zip">
              <Download />
              Download the website
            </a>
          </Button>
        ) : null}
      </form>
      {secretError ? <p className="text-sm text-[#f0b4a4]" role="alert">{secretError}</p> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(280px,1.05fr)_minmax(300px,420px)_minmax(300px,380px)]">
        <div className="order-3 lg:order-1">
          <ScreenStage
            san={bestMove?.san ?? null}
            headline={call}
            squares={squares}
            followedUrl={watchUrl}
            whiteAtBottom={!flipped}
            onGameLink={followFromScreen}
            onBoard={followFromBoard}
          />
        </div>

        <section className="order-2 flex flex-col gap-3" aria-label="Chess.com position">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
                On Chess.com
              </p>
              <h2 className="font-display text-2xl tracking-tight">
                {active ? `${active.white} vs ${active.black}` : "No game yet"}
              </h2>
            </div>
            {refreshing ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                Updating
              </span>
            ) : null}
          </div>

          {games.length > 1 && !watchUrl && !screenGame ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {games.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(game.id);
                    setLinked(null);
                    setWatchUrl(null);
                    setScreenGame(null);
                    setFlipped(false);
                  }}
                  className={`shrink-0 rounded-xl px-3 py-2 text-left text-sm ${
                    game.id === active?.id ? "bg-primary text-primary-foreground" : "bg-white/5"
                  }`}
                >
                  <span className="block font-medium">vs {game.opponent ?? game.black}</span>
                  <span className="block text-xs opacity-70">
                    {labelGame(game)}
                    {game.yourTurn ? " · your move" : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-stretch gap-3">
            <div
              className="relative w-3 shrink-0 overflow-hidden rounded-full ring-1 ring-white/10"
              aria-hidden
              style={{ background: bottomIsWhite ? "#1a1a1a" : "#f3ead7" }}
            >
              <div
                className="absolute inset-x-0 bottom-0"
                style={{
                  height: `${bottomPercent}%`,
                  background: bottomIsWhite ? "#f3ead7" : "#1a1a1a",
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              {active && position ? (
                <Chessboard
                  options={{
                    id: "chesscom-board",
                    position: active.fen,
                    boardOrientation,
                    allowDragging: false,
                    allowDrawingArrows: false,
                    arrows:
                      bestMove && !active.finished
                        ? [
                            {
                              startSquare: bestMove.from,
                              endSquare: bestMove.to,
                              color: "rgba(232, 184, 74, 0.95)",
                            },
                          ]
                        : [],
                    squareStyles:
                      bestMove && !active.finished
                        ? {
                            [bestMove.from]: { backgroundColor: "rgba(232, 184, 74, 0.38)" },
                            [bestMove.to]: { backgroundColor: "rgba(232, 184, 74, 0.72)" },
                          }
                        : {},
                    darkSquareStyle: { backgroundColor: "#769656" },
                    lightSquareStyle: { backgroundColor: "#eeeed2" },
                    darkSquareNotationStyle: { color: "#eeeed2" },
                    lightSquareNotationStyle: { color: "#3d5c2e" },
                    boardStyle: {
                      borderRadius: "14px",
                      boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
                    },
                  }}
                />
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-2xl border border-dashed border-white/15 px-6 text-center text-sm text-muted-foreground">
                  {loading
                    ? "Loading your Chess.com games…"
                    : watchUrl
                      ? "Reading that Chess.com game…"
                      : "Enter your Chess.com username, or share a bot or coach game. The position shows up here."}
                </div>
              )}
            </div>
          </div>
          {active ? (
            <p className="text-sm text-muted-foreground">
              {labelGame(active)}
              {active.rules !== "chess" ? ` · ${active.rules}` : ""}
              {active.moveBy ? ` · move by ${new Date(active.moveBy * 1000).toLocaleString()}` : ""}
              {screenGame ? ". Read from the board on your screen." : ". This board only mirrors Chess.com."}
            </p>
          ) : savedUsername && !loading && !error ? (
            <p className="text-sm text-muted-foreground">
              No current daily games for @{savedUsername}. Live games follow a link. Bot and coach games are read from the shared window.
            </p>
          ) : null}
          {screenGame ? (
            <p className="text-sm text-muted-foreground">
              White is at the bottom. If you are playing Black, flip the board.
            </p>
          ) : null}
          <Button type="button" variant="outline" onClick={toggleFlip} disabled={!active}>
            Flip board
          </Button>
        </section>

        <section className="order-1 lg:order-3" aria-label="The move">
          <div className="paper rounded-2xl p-5 sm:p-6">
            <p className="text-[11px] font-medium tracking-[0.18em] uppercase opacity-60">
              {active?.finished
                ? "Game over on Chess.com"
                : waiting
                  ? `${active?.opponent ?? sideName(turn)} to move`
                  : yourTurn
                    ? "Your move on Chess.com"
                    : `${sideName(turn)} to move`}
            </p>
            <h2 className="font-display mt-2 text-4xl leading-[0.95] tracking-tight">
              {active?.finished
                ? active.note ?? overText ?? "This game is over"
                : problem
                  ? "Cannot read this position"
                  : call ??
                    (status === "error"
                      ? "Engine did not start"
                      : active
                        ? "Looking…"
                        : watchUrl
                          ? "Reading the Chess.com game…"
                          : "Connect Chess.com")}
            </h2>
            <p className="sr-only" aria-live="polite">{speechLine}</p>
            {bestMove && !active?.finished ? (
              <p className="mt-2 font-mono text-sm tracking-wide opacity-70">
                {bestMove.san}
                {squares ? ` · ${squares}` : ""}
              </p>
            ) : null}
            <p className="mt-4 text-base leading-7">
              {active?.finished
                ? "Open the game on Chess.com to see the finished score."
                : problem
                  ? problem
                  : waiting
                    ? `${reason ?? "Reading the position."} Be ready for that, then your move is the next call.`
                    : reason ?? "Load a Chess.com game and the move shows up here."}
            </p>
            {best && !active?.finished && !problem ? (
              <p className="mt-3 text-sm opacity-70">
                <span className="mr-2 rounded-full bg-black/5 px-2.5 py-1 font-mono">
                  {formatEval(best.cp, best.mate, turn)}
                </span>
                {evalSentence(best.cp, best.mate, turn)} Depth {best.depth}
                {settled ? "" : ", still looking"}.
                {bestSans.length > 1 ? ` Then ${bestSans.slice(1, 4).join(" ")}.` : ""}
              </p>
            ) : null}
            {active ? (
              <Button asChild className="mt-5 h-12 w-full text-base">
                <a href={active.url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open this game on Chess.com
                </a>
              </Button>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="voice">Say each new move</Label>
                <p className="text-xs text-muted-foreground">Speaks the Chess.com move once the line settles.</p>
              </div>
              <Switch id="voice" checked={voice} onCheckedChange={toggleVoice} />
            </div>
            <Separator />
            <Button
              type="button"
              variant="outline"
              disabled={!call || Boolean(active?.finished)}
              onClick={() => {
                if (!call || !reason) return;
                const text = forSpeech(`On Chess.com, ${call}. ${reason}`);
                lastSpoken.current = text;
                speak(text);
              }}
            >
              {voice ? <Volume2 /> : <VolumeX />}
              Say it
            </Button>
            <p className="text-xs leading-5 text-muted-foreground">
              {status === "loading" ? "Engine sitting down." : status === "error" ? "Engine failed to start." : "Stockfish is reading the Chess.com position."}
            </p>
          </div>
        </section>
      </div>

      <footer className="pb-4 text-xs leading-5 text-muted-foreground">
        Positions come from Chess.com. Stockfish 19 Lite, GPL-3.0, calls the move. Rated games on Chess.com do not allow an engine. Use this for study and casual games.
      </footer>
    </div>
  );
}

function labelGame(game: ChessComGame): string {
  if (game.timeClass === "bot") return "Bot";
  if (game.timeClass === "coach") return "Coach";
  const speed = game.timeClass === "daily" ? "Daily" : game.kind === "live" ? "Live" : game.timeClass;
  return `${speed}${game.rated ? " · rated" : ""}`;
}

function screenGameFromFen(
  fen: string,
  mode: "bot" | "coach",
  whiteAtBottom: boolean,
  youName: string,
): ChessComGame | null {
  const legal = legalTurn(fen);
  if (!legal) return null;
  const chess = new Chess(legal);
  const you = whiteAtBottom ? "w" : "b";
  const opponent = mode === "coach" ? "Coach" : "Bot";
  const finished = chess.isGameOver();
  return {
    id: `screen-${mode}`,
    url: mode === "coach" ? "https://www.chess.com/play/coach" : "https://www.chess.com/play/computer",
    kind: "live",
    fen: legal,
    turn: chess.turn(),
    white: you === "w" ? youName : opponent,
    black: you === "b" ? youName : opponent,
    rules: "chess",
    timeClass: mode,
    rated: false,
    finished,
    you,
    yourTurn: !finished && you === chess.turn(),
    opponent,
    moveBy: null,
    note: finished ? resultText(chess) : null,
  };
}

function legalTurn(fen: string): string | null {
  if (!positionProblem(fen)) return fen;
  const parts = fen.split(" ");
  if (parts.length < 2) return null;
  parts[1] = parts[1] === "w" ? "b" : "w";
  const other = parts.join(" ");
  return positionProblem(other) ? null : other;
}

function resolveOrientation(you: "w" | "b" | null, flipped: boolean): "white" | "black" {
  const base = you === "b" ? "black" : "white";
  if (!flipped) return base;
  return base === "white" ? "black" : "white";
}

function useStoredUsername() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener(USERNAME_EVENT, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(USERNAME_EVENT, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => window.localStorage.getItem(USERNAME_EVENT) ?? "",
    () => "",
  );
}

function useVoicePreference() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("beside-voice", onChange);
      return () => window.removeEventListener("beside-voice", onChange);
    },
    () => window.localStorage.getItem("beside-voice") === "on",
    () => false,
  );
}
