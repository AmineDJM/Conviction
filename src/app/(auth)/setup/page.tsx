import { redirect } from "next/navigation";
import { hasAnyUser } from "@/server/auth";
import { AuthForm } from "../auth-form";
import { setupAction } from "../actions";
import { Wordmark } from "@/components/wordmark";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up" };

export default function SetupPage() {
  if (hasAnyUser()) redirect("/login");
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-[360px]">
        <Wordmark />
        <h1 className="t-display mb-1">Set up your workspace</h1>
        <p className="mb-6 text-ink-3">Create the owner account. Documents and analyses stay inside this workspace.</p>
        <AuthForm
          action={setupAction}
          submit="Create workspace"
          fields={[
            { name: "workspace", label: "Fund name", placeholder: "VUVP" },
            { name: "name", label: "Your name" },
            { name: "email", label: "Email", type: "email", autoComplete: "email" },
            { name: "password", label: "Password (10+ characters)", type: "password", autoComplete: "new-password" },
          ]}
        />
      </div>
    </main>
  );
}
