import type { DimensionChange } from "@/domain/meetings";
import { Badge, cx } from "@/components/ui";
import { LEVEL_TEXT, LEVEL_TONE, TranscriptRefs } from "./shared";

function Side({ text, level }: { text: string | null; level: string | null }) {
  return (
    <div className="min-w-0">
      {level && (
        <Badge tone={LEVEL_TONE[level] ?? "neutral"} className="mb-0.5 !text-[0.85em]">
          {LEVEL_TEXT[level] ?? level}
        </Badge>
      )}
      <div className="text-ink">{text ?? "—"}</div>
    </div>
  );
}

/**
 * "What changed after the meeting?" — Dimension | Before | Founder said | After | Reason.
 * Before / After are computed by code from the two stored versions; "Founder said" and
 * "Reason" come from the post-meeting extraction and link to the transcript.
 */
export function ChangeTable({ rows, transcriptHref, speakerNames, compact }: { rows: DimensionChange[]; transcriptHref: string; speakerNames?: Record<string, string>; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-separate border-spacing-0 text-[0.95em] print:min-w-0">
        <thead>
          <tr className="text-left text-[0.82em] uppercase tracking-[0.06em] text-ink-3">
            <th className="w-[19%] border-b border-line-strong py-1.5 pr-3 font-semibold">Dimension</th>
            <th className="w-[15%] border-b border-line-strong py-1.5 pr-3 font-semibold">Before</th>
            <th className="w-[24%] border-b border-line-strong py-1.5 pr-3 font-semibold">Founder said</th>
            <th className="w-[15%] border-b border-line-strong py-1.5 pr-3 font-semibold">After</th>
            <th className="border-b border-line-strong py-1.5 font-semibold">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="brief-item align-top">
              <td className="border-b border-line py-2 pr-3">
                <div className="text-[0.8em] font-medium uppercase tracking-[0.05em] text-ink-3">{r.area}</div>
                <div className={cx("leading-snug text-ink", compact && "line-clamp-3")}>{r.dimension}</div>
                {!r.material && <div className="text-[0.8em] text-ink-3">minor</div>}
              </td>
              <td className="border-b border-line py-2 pr-3 text-ink-2">
                <Side text={r.before} level={r.beforeLevel} />
              </td>
              <td className="border-b border-line py-2 pr-3">
                {r.founderSaid ? <div className="leading-snug text-ink-2">“{r.founderSaid}”</div> : <div className="text-ink-3">—</div>}
                {r.founderSaid && <TranscriptRefs refs={r.refs} href={transcriptHref} speakerNames={speakerNames} className="mt-1" />}
              </td>
              <td className="border-b border-line py-2 pr-3">
                <Side text={r.after} level={r.afterLevel} />
              </td>
              <td className="border-b border-line py-2 leading-snug text-ink-2">
                {r.reason ?? <span className="text-ink-3">—</span>}
                {r.guard && <div className="mt-1 text-[0.88em] text-warn">{r.guard}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
