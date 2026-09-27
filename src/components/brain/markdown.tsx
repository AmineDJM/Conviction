"use client";

/**
 * Minimal, safe markdown renderer for model output: builds React elements
 * (never injects HTML). Supports paragraphs, lists, headings, tables, bold,
 * italic, code, links and [n] citations.
 */
import Link from "next/link";
import type { ReactNode } from "react";

export interface CitationRef {
  n: number;
  title: string;
  href: string | null;
  label: string | null;
}

function safeHref(href: string): string | null {
  if (href.startsWith("/")) return href;
  if (/^https?:\/\//i.test(href)) return href;
  return null;
}

function inline(text: string, cites: Map<number, CitationRef>, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\[(\d+(?:\s*,\s*\d+)*)\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k}>{inline(tok.slice(2, -2), cites, k)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="rounded bg-surface-3 px-1 font-mono text-[12px]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("*")) out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    else if (m[2]) {
      const nums = m[2].split(/\s*,\s*/).map(Number);
      out.push(
        <span key={k} className="whitespace-nowrap">
          {nums.map((n) => {
            const c = cites.get(n);
            const href = c?.href ? safeHref(c.href) : null;
            const cls = "mx-[1px] inline-grid h-[15px] min-w-[15px] place-items-center rounded-[4px] bg-surface-3 px-[3px] align-[1px] text-[10px] font-medium text-ink-2 no-underline hover:bg-accent-soft hover:text-accent-text";
            return href ? (
              href.startsWith("/") ? (
                <Link key={n} href={href} className={cls} title={c?.title}>
                  {n}
                </Link>
              ) : (
                <a key={n} href={href} target="_blank" rel="noreferrer noopener" className={cls} title={c?.title}>
                  {n}
                </a>
              )
            ) : (
              <span key={n} className={cls} title={c?.title}>
                {n}
              </span>
            );
          })}
        </span>,
      );
    } else {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const href = safeHref(lm[2]!);
      if (!href) out.push(lm[1]);
      else if (href.startsWith("/"))
        out.push(
          <Link key={k} href={href} className="text-accent-text underline-offset-2 hover:underline">
            {lm[1]}
          </Link>,
        );
      else
        out.push(
          <a key={k} href={href} target="_blank" rel="noreferrer noopener" className="text-accent-text underline-offset-2 hover:underline">
            {lm[1]}
          </a>,
        );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, citations = [] }: { text: string; citations?: CitationRef[] }) {
  const cites = new Map(citations.map((c) => [c.n, c]));
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${b++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={key} className="overflow-x-auto">
          <table>
            {head && (
              <thead>
                <tr>{head.map((h, j) => <th key={j}>{inline(h, cites, `${key}h${j}`)}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j} className="num">{inline(c, cites, `${key}r${ri}c${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<h3 key={key}>{inline(h[2]!, cites, key)}</h3>);
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, cites, `${key}-${j}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^\s*(\||#{1,4}\s|[-*•]\s|\d+[.)]\s)/.test(lines[i]!)) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push(<p key={key}>{inline(para.join(" "), cites, key)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
