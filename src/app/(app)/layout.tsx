import { requireSession } from "@/server/session";
import { MobileNav, Sidebar } from "@/components/shell/sidebar";
import { BrainPanel } from "@/components/brain/brain-panel";
import { CommandPalette } from "@/components/shell/command-palette";
import { ShellProvider } from "@/components/shell/shell-context";
import { logoutAction } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <ShellProvider>
      <div className="flex min-h-dvh">
        <Sidebar workspace={session.workspaceName} user={session.name} logout={logoutAction} />
        <div className="min-w-0 flex-1">
          <MobileNav workspace={session.workspaceName} />
          {children}
        </div>
        <BrainPanel fundName={session.workspaceName} />
      </div>
      <CommandPalette />
    </ShellProvider>
  );
}
