import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Invigilator landing page. Stage 2 only needs the invite to be accepted and a
 * placeholder shown; the real monitor (complaints, live positions, removals)
 * arrives in Stage 4.
 */
export default function Monitor() {
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<{ roomCode: string } | null>(null);
  const acceptInvite = useMutation(api.rooms.acceptInvite);

  const trimmed = code.trim().toUpperCase();
  const preview = useQuery(
    api.rooms.invitePreview,
    trimmed.length > 0 ? { inviteCode: trimmed } : "skip",
  );

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-10 text-foreground sm:px-6">
      <main className="mx-auto max-w-2xl">
        <header className="mb-10 text-center">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Shadow Hunt · Invigilator
          </p>
          <h1 className="mt-3 font-display text-4xl tracking-tight">
            Match monitor
          </h1>
          <p className="mx-auto mt-2 max-w-md text-[13px] text-muted-foreground">
            Invigilators are named by the organiser, are not players, and carry
            no score. Complaints and removals arrive in Stage 4.
          </p>
        </header>

        {accepted === null ? (
          <div className="rounded-xl border border-hairline p-6">
            <div className="grid gap-2">
              <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Invite code
              </Label>
              <Input
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  void setParams(
                    event.target.value ? { code: event.target.value } : {},
                    { replace: true },
                  );
                }}
                placeholder="Six-character invite code"
                className="uppercase tracking-[0.24em]"
              />
            </div>

            {trimmed.length > 0 && preview === undefined && (
              <p className="mt-4 text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
                Checking invite…
              </p>
            )}
            {preview === null && (
              <p className="mt-4 text-[12px] text-destructive">
                That invite code is not valid.
              </p>
            )}
            {preview && preview !== undefined && (
              <div className="mt-4 border-t border-hairline pt-4 text-[14px]">
                <p>
                  {preview.displayName} · room{" "}
                  <span className="tracking-[0.16em]">{preview.roomCode}</span>
                </p>
                <p className="mt-1 text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
                  {preview.status}
                </p>
              </div>
            )}

            {error && (
              <p className="mt-4 text-[12px] text-destructive">{error}</p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-11 uppercase tracking-[0.18em]"
              >
                <Link to="/play">Back</Link>
              </Button>
              <Button
                type="button"
                size="lg"
                disabled={preview == null}
                className="h-11 uppercase tracking-[0.18em]"
                onClick={async () => {
                  setError(null);
                  try {
                    const result = await acceptInvite({ inviteCode: trimmed });
                    setAccepted({ roomCode: result.roomCode });
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Could not accept the invite.",
                    );
                  }
                }}
              >
                Accept invite
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-hairline p-6 text-center">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Attached to room
            </p>
            <p className="mt-2 font-display text-4xl tracking-[0.16em]">
              {accepted.roomCode}
            </p>
            <p className="mt-4 text-[13px] text-muted-foreground">
              The monitor is a placeholder until Stage 4. You are not in the
              roster and you have no score.
            </p>
            <div className="mt-8 flex justify-center">
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-11 uppercase tracking-[0.18em]"
              >
                <Link to="/play">Back to rooms</Link>
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
