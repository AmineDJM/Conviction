"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

interface Shell {
  brainOpen: boolean;
  setBrainOpen: (v: boolean) => void;
  toggleBrain: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  /** Ask the Fund Brain a question programmatically (e.g. from a page action). */
  ask: (q: string) => void;
  pendingQuestion: string | null;
  consumeQuestion: () => void;
}

const Ctx = createContext<Shell | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [brainOpen, setBrainOpenState] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingQuestion, setPending] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem("cv.brain") === "1") setBrainOpenState(true);
    } catch {}
  }, []);

  const setBrainOpen = useCallback((v: boolean) => {
    setBrainOpenState(v);
    try {
      localStorage.setItem("cv.brain", v ? "1" : "0");
    } catch {}
  }, []);
  const toggleBrain = useCallback(() => setBrainOpen(!brainOpen), [brainOpen, setBrainOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setBrainOpen(!brainOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [brainOpen, setBrainOpen]);

  const ask = useCallback(
    (q: string) => {
      setPending(q);
      setBrainOpen(true);
    },
    [setBrainOpen],
  );

  return (
    <Ctx.Provider value={{ brainOpen, setBrainOpen, toggleBrain, paletteOpen, setPaletteOpen, ask, pendingQuestion, consumeQuestion: () => setPending(null) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useShell() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShell outside ShellProvider");
  return c;
}
