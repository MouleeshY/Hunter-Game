import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useEnsureProfile } from "@/client/api";
import { getSupabaseClient, requireSupabaseClient } from "@/client/supabase";

export interface AuthProfile {
  id: string;
  name: string | null;
  email: string | null;
}

function profileFrom(user: User | null): AuthProfile | null {
  if (user === null) return null;
  const metadataName =
    typeof user.user_metadata["full_name"] === "string"
      ? user.user_metadata["full_name"]
      : typeof user.user_metadata["name"] === "string"
        ? user.user_metadata["name"]
        : null;
  return {
    id: user.id,
    name: metadataName,
    email: user.email ?? null,
  };
}

export function useAuth() {
  const [user, setUser] = useState<AuthProfile | null>(null);
  const [isLoading, setIsLoading] = useState(
    () => getSupabaseClient() !== null,
  );
  const ensureProfile = useEnsureProfile();

  const finishSignIn = useCallback(
    async (authUser: User | null) => {
      const current = profileFrom(authUser);
      setUser(current);
      if (authUser !== null) {
        const profile = await ensureProfile();
        setUser({
          id: profile.id,
          name: profile.name ?? current?.name ?? null,
          email: profile.email ?? current?.email ?? null,
        });
      }
    },
    [ensureProfile],
  );

  useEffect(() => {
    const client = getSupabaseClient();
    if (client === null) return;

    let active = true;
    void client.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (error) throw error;
        if (!active) return;
        await finishSignIn(data.session?.user ?? null);
      })
      .catch((cause: unknown) => {
        if (active) {
          console.error("Could not restore the Supabase session.", cause);
          setUser(null);
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(profileFrom(session?.user ?? null));
      if (session?.user) {
        queueMicrotask(() => {
          void ensureProfile()
            .then((profile) => {
              setUser((current) =>
                current === null
                  ? current
                  : {
                      id: profile.id,
                      name: profile.name ?? current.name,
                      email: profile.email ?? current.email,
                    },
              );
            })
            .catch((cause: unknown) => {
              console.error("Could not create the user profile.", cause);
            });
        });
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [ensureProfile, finishSignIn]);

  const signInWithGoogle = useCallback(async (returnTo = "/play") => {
    const redirectTo = new URL("/auth", window.location.origin);
    redirectTo.searchParams.set("returnTo", returnTo);
    const { error } = await requireSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo.toString() },
    });
    if (error) throw error;
  }, []);

  const requestEmailCode = useCallback(async (email: string) => {
    const { error } = await requireSupabaseClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) {
      throw new Error(
        `Could not send an email code. Supabase SMTP must be configured under Authentication > SMTP. ${error.message}`,
      );
    }
  }, []);

  const verifyEmailCode = useCallback(
    async (email: string, token: string) => {
      const { data, error } = await requireSupabaseClient().auth.verifyOtp({
        email,
        token,
        type: "email",
      });
      if (error) throw new Error("That email code is invalid or expired.");
      await finishSignIn(data.user);
    },
    [finishSignIn],
  );

  const signIn = useCallback(
    async (provider: "google" | "email-otp", formData?: FormData) => {
      if (provider === "google") {
        await signInWithGoogle();
        return;
      }
      const email = formData?.get("email");
      const code = formData?.get("code");
      if (typeof email !== "string" || email.length === 0) {
        throw new Error("Enter a valid email address.");
      }
      if (typeof code === "string" && code.length > 0) {
        await verifyEmailCode(email, code);
      } else {
        await requestEmailCode(email);
      }
    },
    [requestEmailCode, signInWithGoogle, verifyEmailCode],
  );

  const signOut = useCallback(async () => {
    const { error } = await requireSupabaseClient().auth.signOut();
    if (error) throw error;
  }, []);

  return {
    isLoading,
    isAuthenticated: user !== null,
    user,
    signIn,
    signOut,
    signInWithGoogle,
    requestEmailCode,
    verifyEmailCode,
  };
}
