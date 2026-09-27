import { redirect } from "next/navigation";
import { hasAnyUser } from "@/server/auth";
import { getSession } from "@/server/session";
import { AuthForm } from "../auth-form";
import { loginAction } from "../actions";
import { Wordmark } from "@/components/wordmark";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (!hasAnyUser()) redirect("/setup");
  if (await getSession()) redirect("/");
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-[340px]">
        <Wordmark />
        <h1 className="t-display mb-1">Sign in</h1>
        <p className="mb-6 text-ink-3">Your fund&apos;s underwriting workspace.</p>
        <AuthForm
          action={loginAction}
          submit="Sign in"
          fields={[
            { name: "email", label: "Email", type: "email", autoComplete: "email" },
            { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
          ]}
        />
      </div>
    </main>
  );
}
