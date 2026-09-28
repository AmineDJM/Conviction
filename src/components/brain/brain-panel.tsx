"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useShell } from "@/components/shell/shell-context";
import { cx, Kbd } from "@/components/ui";
import { Markdown, type CitationRef } from "./markdown";

interface Msg {
  role: "user" | "assistant";
  content: string;
  citations?: (CitationRef & { kind: string })[];
  status?: string | null;
  meta?: { firstTokenMs: number | null; latencyMs: number; costUsd: number } | null;
  error?: string | null;
}

const SUGGESTIONS_GLOBAL = ["What are our 3 best deals by fund-return potential?", "Which deals have NRR above 120%?", "Have we seen a company similar to this before?", "What did we pass on recently, and why?"];
const SUGGESTIONS_DEAL = ["Challenge this thesis.", "Show me the evidence behind the ARR.", "What must be true for this to return the fund?", "What should I ask the founder first?"];

function contextSlug(path: string) {
  const m = /^\/deals\/([^/?#]+)/.exec(path);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function BrainPanel({ fundName }: { fundName: string }) {
  const { brainOpen, setBrainOpen, pendingQuestion, consumeQuestion } = useShell();
  const path = usePathname();
  const slug = contextSlug(path);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [contextName, setContextName] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (brainOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [brainOpen]);

  useEffect(() => {
    if (!slug) return setContextName(null);
    fetch(`/api/deals/${encodeURIComponent(slug)}/name`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setContextName(d?.name ?? null))
      .catch(() => setContextName(null));
  }, [slug]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [msgs]);

  useEffect(() => {
    if (pendingQuestion && brainOpen && !busy) {
      const q = pendingQuestion;
      consumeQuestion();
      void send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion, brainOpen]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setInput("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: question }, { role: "assistant", content: "", status: "Understanding the question", citations: [] }]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const patch = (fn: (m: Msg) => Msg) => setMsgs((all) => [...all.slice(0, -1), fn(all[all.length - 1]!)]);
    try {
      const res = await fetch("/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, threadId, contextSlug: slug }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        // Error responses are JSON ({ error }); fall back to the raw text, then the status.
        const text = await res.text().catch(() => "");
        let message = text;
        try {
          const j = JSON.parse(text) as { error?: unknown; message?: unknown };
          message = typeof j.error === "string" ? j.error : typeof j.message === "string" ? j.message : text;
        } catch {}
        throw new Error(message || `The Fund Brain is unavailable (HTTP ${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (!chunk.startsWith("data: ")) continue;
          const ev = JSON.parse(chunk.slice(6));
          if (ev.type === "thread") setThreadId(ev.threadId);
          else if (ev.type === "status") patch((m) => ({ ...m, status: ev.text }));
          else if (ev.type === "citations") patch((m) => ({ ...m, citations: ev.items }));
          else if (ev.type === "delta") patch((m) => ({ ...m, status: null, content: m.content + ev.text }));
          // Citation verification replaces the draft with the checked answer (unsupported parts trimmed or marked as inference).
          else if (ev.type === "revision") patch((m) => ({ ...m, status: null, content: ev.text }));
          else if (ev.type === "done") patch((m) => ({ ...m, status: null, meta: { firstTokenMs: ev.firstTokenMs, latencyMs: ev.latencyMs, costUsd: ev.costUsd } }));
          else if (ev.type === "error") patch((m) => ({ ...m, status: null, error: ev.message }));
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") patch((m) => ({ ...m, status: null, error: (e as Error).message.slice(0, 200) }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  if (!brainOpen) return null;
  const suggestions = slug ? SUGGESTIONS_DEAL : SUGGESTIONS_GLOBAL;

  return (
    <aside className="no-print sticky top-0 flex h-dvh w-[420px] shrink-0 flex-col border-l border-line bg-surface anim-in max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-full max-lg:max-w-[440px] max-lg:shadow-[var(--shadow-pop)]">
      <header className="flex h-12 items-center justify-between border-b border-line px-4">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">Fund Brain</span>
          <span className="text-[12px] text-ink-3">{contextName ? `· ${contextName}` : `· all of ${fundName}`}</span>
        </div>
        <div className="flex items-center gap-1">
          {msgs.length > 0 && (
            <button
              onClick={() => {
                abortRef.current?.abort();
                setMsgs([]);
                setThreadId(null);
              }}
              className="rounded px-2 py-1 text-[12px] text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              New
            </button>
          )}
          <button onClick={() => setBrainOpen(false)} className="rounded px-2 py-1 text-[12px] text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close">
            Close
          </button>
        </div>
      </header>

      <div ref={scroller} className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-[13.5px] leading-relaxed">
        {msgs.length === 0 && (
          <div className="pt-2">
            <p className="mb-4 text-ink-2">
              Ask anything across every deck, memo, source and decision in {fundName}.
              {contextName ? ` Questions default to ${contextName}.` : ""}
            </p>
            <div className="flex flex-col items-start gap-1.5">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-md border border-line px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-8 rounded-lg bg-surface-2 px-3 py-2 text-ink">
              {m.content}
            </div>
          ) : (
            <div key={i} className="anim-in">
              {m.status && (
                <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
                  {m.status}
                </div>
              )}
              {m.content && <Markdown text={m.content} citations={m.citations} />}
              {m.error && <div className="mt-2 text-[12.5px] text-risk">{m.error}</div>}
              {m.citations && m.citations.length > 0 && !m.status && <Sources items={m.citations} />}
              {m.meta && (
                <div className="mt-2 text-[11px] text-ink-3 num">
                  {m.meta.firstTokenMs !== null ? `first token ${(m.meta.firstTokenMs / 1000).toFixed(1)}s · ` : ""}
                  {(m.meta.latencyMs / 1000).toFixed(1)}s · ${m.meta.costUsd.toFixed(4)}
                </div>
              )}
            </div>
          ),
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="border-t border-line p-3"
      >
        <div className="rounded-lg border border-line bg-bg focus-within:border-accent">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder={contextName ? `Ask about ${contextName} or the whole dealflow…` : "Ask about any deal, founder, metric or decision…"}
            className="block w-full resize-none bg-transparent px-3 py-2 text-[13.5px] outline-none placeholder:text-ink-3"
          />
          <div className="flex items-center justify-between px-3 pb-2 text-[11px] text-ink-3">
            <span>
              <Kbd>↵</Kbd> send · <Kbd>⇧↵</Kbd> newline · <Kbd>⌘J</Kbd> toggle
            </span>
            {busy ? (
              <button type="button" onClick={() => abortRef.current?.abort()} className="text-ink-2 hover:text-ink">
                Stop
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()} className={cx("font-medium", input.trim() ? "text-accent-text" : "text-ink-3")}>
                Send
              </button>
            )}
          </div>
        </div>
      </form>
    </aside>
  );
}

function Sources({ items }: { items: (CitationRef & { kind: string })[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)} className="text-[11.5px] text-ink-3 hover:text-ink">
        {open ? "Hide" : "Show"} {items.length} sources
      </button>
      {open && (
        <ol className="mt-1.5 space-y-1 text-[12px]">
          {items.map((c) => (
            <li key={c.n} className="flex gap-2">
              <span className="num w-4 shrink-0 text-right text-ink-3">{c.n}</span>
              {c.href ? (
                <a href={c.href} target={c.href.startsWith("/") ? undefined : "_blank"} rel="noreferrer noopener" className="truncate text-ink-2 hover:text-accent-text">
                  {c.title}
                </a>
              ) : (
                <span className="truncate text-ink-2">{c.title}</span>
              )}
              {c.label && <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-ink-3">{c.label.replace("_", " ")}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
