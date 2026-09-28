import type { ReactNode } from "react";
import { FormationNav } from "@/components/formation/formation-nav";

export const metadata = { title: "Formation" };

export default function FormationLayout({ children }: { children: ReactNode }) {
  return (
    <main className="pb-16">
      <header className="px-4 pb-4 pt-8 md:px-8">
        <h1 className="t-display">Formation</h1>
        <p className="mt-1 max-w-3xl text-ink-3">Deliberate practice on the real deals in this workspace. You answer first, from what the deck showed; the analysis, the evidence and the reasoning are revealed only after your answer is on record.</p>
      </header>
      <FormationNav />
      <div className="mx-auto max-w-[1180px] px-4 pt-8 md:px-8">{children}</div>
    </main>
  );
}
