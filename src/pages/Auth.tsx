import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { ArrowRight, Loader2, Mail } from "lucide-react";

interface AuthProps {
  redirectAfterAuth?: string;
}

function safeReturnTo(value: string | null, fallback: string): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

function Auth({ redirectAfterAuth = "/play" }: AuthProps = {}) {
  const {
    isLoading: authLoading,
    isAuthenticated,
    signInWithGoogle,
    requestEmailCode,
    verifyEmailCode,
  } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = safeReturnTo(searchParams.get("returnTo"), redirectAfterAuth);
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) navigate(redirect, { replace: true });
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <img
            src="/logo.svg"
            alt="Shadow Hunt"
            width={64}
            height={64}
            className="mx-auto mb-2 rounded-lg"
          />
          <CardTitle>Sign in to Shadow Hunt</CardTitle>
          <CardDescription>
            Use Google, or request a one-time email code.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Button
            type="button"
            className="w-full"
            disabled={busy}
            onClick={() => void run(() => signInWithGoogle(redirect))}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Continue with Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or email</span>
            </div>
          </div>

          {!codeSent ? (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await requestEmailCode(email);
                  setCodeSent(true);
                });
              }}
            >
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="pl-9"
                  required
                />
              </div>
              <Button type="submit" variant="outline" disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Send one-time code
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <p className="text-xs text-muted-foreground">
                Email codes require SMTP to be configured in Supabase under
                Authentication → SMTP.
              </p>
            </form>
          ) : (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await verifyEmailCode(email, code);
                  navigate(redirect, { replace: true });
                });
              }}
            >
              <CardDescription className="text-center">
                Enter the code sent to {email}.
              </CardDescription>
              <InputOTP value={code} onChange={setCode} maxLength={6} disabled={busy}>
                <InputOTPGroup>
                  {Array.from({ length: 6 }, (_, index) => (
                    <InputOTPSlot key={index} index={index} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              <Button type="submit" disabled={busy || code.length !== 6}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Verify code
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setCodeSent(false);
                  setCode("");
                  setError(null);
                }}
              >
                Use a different email
              </Button>
            </form>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </CardContent>
        <CardFooter className="justify-center text-xs text-muted-foreground">
          Your session and profile are managed by Supabase.
        </CardFooter>
      </Card>
    </main>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
