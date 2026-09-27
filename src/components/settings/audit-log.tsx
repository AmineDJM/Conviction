import Link from "next/link";
import { Button, Empty, Section } from "@/components/ui";
import { titleCase } from "@/lib/format";

interface Row {
  id: string;
  action: string;
  target: string | null;
  detail: string | null;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
}

const select = "h-8 rounded-md border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent";

function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** Server-rendered audit trail (last 200 matching rows), filtered through a plain GET form. */
export function AuditLog({ rows, actions, members, targets, filter }: { rows: Row[]; actions: string[]; members: { userId: string; name: string }[]; targets: Record<string, string>; filter: { action: string; user: string; q: string } }) {
  const filtered = !!(filter.action || filter.user || filter.q);
  return (
    <Section eyebrow="Audit log" title={filtered ? `${rows.length} matching event${rows.length === 1 ? "" : "s"}` : "Last 200 events"}>
      <form method="get" action="/settings" className="mb-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="tab" value="audit" />
        <select name="action" defaultValue={filter.action} className={select} aria-label="Action">
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {titleCase(a)}
            </option>
          ))}
        </select>
        <select name="user" defaultValue={filter.user} className={select} aria-label="Actor">
          <option value="">All people</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
          <option value="system">System</option>
        </select>
        <input name="q" defaultValue={filter.q} placeholder="Target or detail contains…" className={`${select} w-56 px-2.5`} />
        <Button type="submit" size="sm">
          Filter
        </Button>
        {filtered && (
          <Link href="/settings?tab=audit" className="text-[12.5px] text-ink-3 hover:text-ink">
            Clear
          </Link>
        )}
      </form>
      {rows.length === 0 ? (
        <Empty title={filtered ? "No events match these filters" : "No audited events yet"}>Member changes, analyses, decisions, deletions, backups and exports are recorded here.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12.5px]">
            <thead>
              <tr className="text-left text-[11.5px] text-ink-3">
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Who</th>
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Target</th>
                <th className="py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="num whitespace-nowrap py-1.5 pr-4 text-ink-3">{when(r.createdAt)}</td>
                  <td className="whitespace-nowrap py-1.5 pr-4" title={r.userEmail ?? undefined}>
                    {r.userName ?? (r.userId ? <span className="text-ink-3">Former member</span> : <span className="text-ink-3">System</span>)}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-4 font-medium">{titleCase(r.action)}</td>
                  <td className="py-1.5 pr-4 text-ink-2" title={r.target ?? undefined}>
                    {r.target ? targets[r.target] ?? <span className="font-mono text-[11.5px]">{r.target}</span> : "—"}
                  </td>
                  <td className="py-1.5 text-ink-2">{r.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
