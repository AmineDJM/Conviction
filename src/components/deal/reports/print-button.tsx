"use client";

import { Button } from "@/components/ui";

/** Prints the current page. App chrome is hidden by `.no-print` rules. */
export function PrintButton({ label = "Print / PDF", size = "sm" }: { label?: string; size?: "sm" | "md" }) {
  return (
    <Button size={size} onClick={() => window.print()} className="no-print" title="Print or save as PDF (the page is laid out for A4 / Letter)">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M4 6V2h8v4M4 12H2.5A.5.5 0 0 1 2 11.5v-5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5H12M4 9.5h8V14H4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      {label}
    </Button>
  );
}
