"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { asset } from "@/lib/base-path";
import { parseInfo, type EngineLine } from "@/lib/coach";

type Listener = (uci: string, fen: string) => void;

const ENGINE_URL = "/engine/stockfish-19-lite-single.js";

export function useStockfish(
  fen: string | null,
  depth: number,
  bootId: number,
) {
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [searching, setSearching] = useState(false);

  const [prevBoot, setPrevBoot] = useState(bootId);
  if (bootId !== prevBoot) {
    setPrevBoot(bootId);
    setStatus("loading");
    setLines([]);
    setSearching(false);
  }

  const [tracked, setTracked] = useState({ fen, depth });
  if (fen !== tracked.fen || depth !== tracked.depth) {
    setTracked({ fen, depth });
    setLines([]);
    if (!fen) setSearching(false);
  }

  const statusRef = useRef<"loading" | "ready" | "error">("loading");
  const searchingRef = useRef(false);
  const ignoreInfoRef = useRef(false);
  const currentFenRef = useRef<string | null>(null);
  const pendingFenRef = useRef<string | null>(fen);
  const depthStartedRef = useRef(depth);
  const depthRef = useRef(depth);
  const bufferRef = useRef<Map<number, EngineLine>>(new Map());
  const listenersRef = useRef<Set<Listener>>(new Set());
  const rafRef = useRef(0);
  const beginRef = useRef<(nextFen: string) => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    statusRef.current = "loading";
    searchingRef.current = false;

    const worker = new Worker(asset(ENGINE_URL));
    workerRef.current = worker;

    const publish = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (cancelled) return;
        const next = [...bufferRef.current.values()].sort(
          (a, b) => a.multipv - b.multipv || b.depth - a.depth,
        );
        setLines(next);
      });
    };

    const begin = (nextFen: string) => {
      if (cancelled || !workerRef.current || statusRef.current !== "ready") {
        pendingFenRef.current = nextFen;
        return;
      }
      ignoreInfoRef.current = false;
      bufferRef.current = new Map();
      setLines([]);
      currentFenRef.current = nextFen;
      pendingFenRef.current = null;
      searchingRef.current = true;
      depthStartedRef.current = depthRef.current;
      setSearching(true);
      worker.postMessage(`position fen ${nextFen}`);
      worker.postMessage(`go depth ${depthRef.current}`);
    };

    beginRef.current = begin;

    worker.onmessage = (event: MessageEvent<string>) => {
      if (cancelled) return;
      const line = typeof event.data === "string" ? event.data : "";
      if (!line) return;

      if (line === "uciok") {
        worker.postMessage("setoption name MultiPV value 3");
        worker.postMessage("isready");
        return;
      }

      if (line === "readyok") {
        statusRef.current = "ready";
        setStatus("ready");
        const next = pendingFenRef.current;
        if (next) begin(next);
        return;
      }

      if (line.startsWith("info ")) {
        if (ignoreInfoRef.current) return;
        const parsed = parseInfo(line);
        if (!parsed) return;
        bufferRef.current.set(parsed.multipv, parsed);
        publish();
        return;
      }

      if (line.startsWith("bestmove")) {
        const uci = line.split(/\s+/)[1];
        const completedFen = currentFenRef.current;
        const aborted = ignoreInfoRef.current;
        searchingRef.current = false;
        setSearching(false);
        if (!aborted && uci && uci !== "(none)" && completedFen) {
          listenersRef.current.forEach((listener) => listener(uci, completedFen));
        }
        const next = pendingFenRef.current;
        const depthStale = depthStartedRef.current !== depthRef.current;
        if (next && (next !== completedFen || depthStale)) {
          pendingFenRef.current = null;
          begin(next);
        } else {
          pendingFenRef.current = null;
        }
      }
    };

    worker.onerror = () => {
      if (cancelled) return;
      statusRef.current = "error";
      setStatus("error");
    };

    worker.postMessage("uci");

    const slow = window.setTimeout(() => {
      if (!cancelled && statusRef.current !== "ready") {
        statusRef.current = "error";
        setStatus("error");
      }
    }, 20000);

    return () => {
      cancelled = true;
      window.clearTimeout(slow);
      cancelAnimationFrame(rafRef.current);
      beginRef.current = () => {};
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      searchingRef.current = false;
      statusRef.current = "loading";
    };
  }, [bootId]);

  useEffect(() => {
    depthRef.current = depth;
    pendingFenRef.current = fen;

    if (!fen) {
      if (searchingRef.current) {
        ignoreInfoRef.current = true;
        workerRef.current?.postMessage("stop");
      }
      currentFenRef.current = null;
      bufferRef.current = new Map();
      searchingRef.current = false;
      return;
    }

    if (statusRef.current !== "ready") return;

    const sameSearch =
      fen === currentFenRef.current && depthStartedRef.current === depth;
    if (sameSearch && (searchingRef.current || bufferRef.current.size > 0)) return;

    if (searchingRef.current) {
      ignoreInfoRef.current = true;
      bufferRef.current = new Map();
      workerRef.current?.postMessage("stop");
      return;
    }

    beginRef.current(fen);
  }, [fen, depth, bootId, status]);

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const latestDepth = lines.reduce((max, line) => Math.max(max, line.depth), 0);
  const currentLines =
    latestDepth === 0 ? lines : lines.filter((line) => line.depth === latestDepth);

  return {
    status,
    lines: fen ? currentLines : [],
    searching: fen ? searching : false,
    subscribe,
  };
}
