"use client";

import { useEffect, useRef, useState } from "react";
import { Monitor, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadPieceSets, readBoardFromVideo, type BoardBox, type PieceSet } from "@/lib/board-vision";
import { createScreenReader, readScreenHint } from "@/lib/screen-link";

type ScreenStageProps = {
  san: string | null;
  headline: string | null;
  squares: string | null;
  followedUrl: string | null;
  whiteAtBottom: boolean;
  onGameLink: (url: string) => void;
  onBoard: (fen: string, mode: "bot" | "coach", detected: boolean) => void;
};

export function ScreenStage({
  san,
  headline,
  squares,
  followedUrl,
  whiteAtBottom,
  onGameLink,
  onBoard,
}: ScreenStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onGameLinkRef = useRef(onGameLink);
  const onBoardRef = useRef(onBoard);
  const whiteAtBottomRef = useRef(whiteAtBottom);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [reading, setReading] = useState(false);
  const [foundUrl, setFoundUrl] = useState<string | null>(null);
  const [boardMode, setBoardMode] = useState<"bot" | "coach" | null>(null);
  const [tabOnly, setTabOnly] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (!stream) return;
    void video.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    onGameLinkRef.current = onGameLink;
    onBoardRef.current = onBoard;
    whiteAtBottomRef.current = whiteAtBottom;
  }, [onBoard, onGameLink, whiteAtBottom]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  useEffect(() => {
    if (!stream) return;
    const video = videoRef.current;
    if (!video) return;
    const frame = video;
    let cancelled = false;
    let lastSeen = "";
    let streak = 0;
    let announced = "";
    let lastFen = "";
    let fenStreak = 0;
    let pass = 0;
    let pieces: PieceSet[] = [];
    let boardHint: BoardBox | null = null;

    async function watch() {
      setReading(true);
      let reader: Awaited<ReturnType<typeof createScreenReader>> | null = null;
      try {
        reader = await createScreenReader();
        pieces = await loadPieceSets().catch(() => []);
        if (cancelled) return;
        while (!cancelled) {
          pass += 1;
          let hint = { link: null as string | null, mode: null as "bot" | "coach" | null };
          try {
            hint = await readScreenHint(reader, frame, false);
            if (!hint.link && !hint.mode && pass % 3 === 0) {
              hint = await readScreenHint(reader, frame, true);
            }
          } catch {
            hint = { link: null, mode: null };
          }
          if (cancelled) return;
          const onBotPage = hint.mode === "bot" || hint.mode === "coach";
          if (onBotPage) {
            announced = "";
            setFoundUrl(null);
          }
          if (hint.link && !onBotPage) {
            if (hint.link === lastSeen) {
              streak += 1;
              if (streak >= 2 && hint.link !== announced) {
                announced = hint.link;
                setFoundUrl(hint.link);
                setBoardMode(null);
                onGameLinkRef.current(hint.link);
              }
            } else {
              lastSeen = hint.link;
              streak = 1;
            }
          } else if (pieces.length > 0 && (onBotPage || !announced)) {
            let read: ReturnType<typeof readBoardFromVideo> = null;
            try {
              read = readBoardFromVideo(frame, pieces, whiteAtBottomRef.current, boardHint);
            } catch {
              read = null;
            }
            boardHint = read?.box ?? boardHint;
            if (read && read.fen === lastFen) {
              fenStreak += 1;
              if (fenStreak >= 2) {
                const mode = hint.mode ?? "bot";
                setBoardMode(mode);
                onBoardRef.current(read.fen, mode, onBotPage);
              }
            } else if (read) {
              lastFen = read.fen;
              fenStreak = 1;
            }
          }
          await new Promise((resolve) => window.setTimeout(resolve, 900));
        }
      } catch {
        if (!cancelled) {
          setError("Could not read the Chess.com window. Paste the game link instead.");
        }
      } finally {
        if (!cancelled) setReading(false);
        await reader?.terminate().catch(() => {});
      }
    }

    void watch();
    return () => {
      cancelled = true;
    };
  }, [stream]);

  async function startShare() {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("This browser cannot share a screen. Load the Chess.com game from your username or the game link.");
      return;
    }
    setStarting(true);
    try {
      const next = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 8, displaySurface: "window" },
        audio: false,
        monitorTypeSurfaces: "include",
        surfaceSwitching: "include",
        selfBrowserSurface: "exclude",
      } as DisplayMediaStreamOptions);
      const track = next.getVideoTracks()[0];
      const surface = track?.getSettings().displaySurface;
      setTabOnly(surface === "browser");
      setFoundUrl(null);
      track?.addEventListener("ended", () => {
        setStream((current) => (current === next ? null : current));
        setFoundUrl(null);
        setBoardMode(null);
        setTabOnly(false);
      });
      setStream(next);
    } catch (caught) {
      const name = caught instanceof DOMException ? caught.name : "";
      if (name === "NotAllowedError" || name === "AbortError") {
        setError("Screen sharing was dismissed. Allow it when the browser asks.");
      } else {
        setError("The screen did not open. The move is still on the card, and the game is on Chess.com.");
      }
    } finally {
      setStarting(false);
    }
  }

  function stopShare() {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setBoardMode(null);
    setFoundUrl(null);
    setTabOnly(false);
  }

  const live = Boolean(stream);

  return (
    <section className="flex min-h-[280px] flex-col gap-3" aria-label="Your screen">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Your screen
          </p>
          <h2 className="font-display text-2xl tracking-tight">Your Chess.com window</h2>
        </div>
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#6e2a22] px-2.5 py-1 text-xs font-medium text-[#f6e7df]">
            <span className="size-1.5 rounded-full bg-[#f0b429]" />
            Live
          </span>
        ) : null}
      </div>

      <div className="relative flex min-h-[240px] flex-1 overflow-hidden rounded-2xl border border-white/10 bg-[#100e0c] shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
        <video
          ref={videoRef}
          className={
            live
              ? "aspect-video max-h-[72vh] w-full bg-black object-contain"
              : "hidden"
          }
          autoPlay
          muted
          playsInline
        />

        {live && headline ? (
          <div className="paper pointer-events-none absolute inset-x-3 bottom-3 rounded-xl px-4 py-3 sm:inset-x-4">
            <p className="text-[11px] font-medium tracking-[0.16em] uppercase opacity-70">
              Play this on Chess.com
            </p>
            <p className="font-display text-3xl leading-none tracking-tight">{headline}</p>
            <p className="mt-1 font-mono text-sm tracking-wide opacity-80">
              {san}
              {squares ? ` · ${squares}` : ""}
            </p>
          </div>
        ) : null}

        {!live ? (
          <div className="flex flex-1 flex-col justify-between gap-6 p-5 sm:p-7">
            <div className="flex flex-1 flex-col items-start justify-center gap-4">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-white/5 text-primary">
                <Monitor className="size-6" />
              </span>
              <div className="max-w-md space-y-2">
                <p className="font-display text-3xl leading-tight tracking-tight">
                  Put Chess.com on this screen.
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  Share the Chess.com window. Beside follows a live game from the address bar, and reads the board in bot and coach games.
                </p>
              </div>
              <ol className="grid gap-2 text-sm text-foreground/80">
                <li>1. Share the Chess.com window, not only the tab.</li>
                <li>2. Live games follow the address. Bot and coach games are read from the board.</li>
                <li>3. Play the called move on Chess.com.</li>
              </ol>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                size="lg"
                className="h-11 w-fit px-4"
                onClick={() => void startShare()}
                disabled={starting}
              >
                <Monitor />
                {starting ? "Waiting for the window…" : "Show my screen"}
              </Button>
              {error ? (
                <p className="text-sm text-[#f0b4a4]" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {live ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {foundUrl && followedUrl === foundUrl
              ? "Copied the Chess.com link. Following that game."
              : boardMode
                ? `Reading the ${boardMode === "coach" ? "coach" : "bot"} board on Chess.com.`
                : reading
                  ? "Reading the board on Chess.com…"
                  : tabOnly
                    ? "The board is visible in a tab share. Beside reads it from the picture."
                    : "Looking for the Chess.com game. The call sits on the picture."}
          </p>
          <Button type="button" variant="outline" onClick={stopShare}>
            <Square />
            Stop sharing
          </Button>
        </div>
      ) : null}
    </section>
  );
}
