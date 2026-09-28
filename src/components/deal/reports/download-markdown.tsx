"use client";

import { Button } from "@/components/ui";

/** Downloads a report's deterministic markdown rendering (built on the server from the same structured report). */
export function DownloadMarkdownButton({ filename, content, label = "Download .md" }: { filename: string; content: string; label?: string }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Button size="sm" variant="secondary" onClick={download} className="no-print" title="Markdown export of this report (same content, refs kept)">
      {label}
    </Button>
  );
}
