import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MapView } from "@/server/positionService";

/**
 * The organiser's status board (Stage 5, task 8): who is in, who has confirmed
 * the rules, whose phone is reporting — plus the End / Abort / Pause buttons.
 *
 * Shown on the match screen while the match is running, and in the lobby before
 * it starts. Permission is enforced on the server; this only hides what the
 * viewer cannot do.
 */
export function StaffPanel(props: { view: MapView; nowMs: number }) {
  const { view, nowMs } = props;
  const staff = view.staff;
  const pause = useMutation(api.rooms.pauseRoom);
  const resume = useMutation(api.rooms.resumeRoom);
  const end = useMutation(api.rooms.endRoom);
  const abort = useMutation(api.rooms.abortRoom);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abortOpen, setAbortOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [endConfirm, setEndConfirm] = useState(false);

  if (!staff) return null;

  const isOrganiser = view.me.isOrganiser;
  const canPause =
    view.status === "headstart" || view.status === "live";
  const canAbort =
    isOrganiser || view.me.isInvigilator
      ? view.status === "setup" || canPause
      : false;
  const reportsPositions = view.status === "setup" || view.status === "live";

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const signalLabel = (lastUploadAtMs: number | null): string => {
    if (lastUploadAtMs === null) return "Location off";
    const ageSeconds = Math.round((nowMs - lastUploadAtMs) / 1000);
    if (ageSeconds > 30) return `Out of signal · ${ageSeconds}s`;
    return `Reporting · ${ageSeconds}s ago`;
  };

  return (
    <section className="rounded-xl border-2 border-foreground/70 bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Staff board
        </p>
        <p className="text-[13px] text-muted-foreground">
          {staff.playerCount} players · {staff.briefedCount} confirmed the rules
        </p>
      </div>

      <ul className="mt-3 grid gap-1">
        {staff.players.map((player) => {
          const last = player.lastUploadAtMs;
          const age = last === null ? null : Math.round((nowMs - last) / 1000);
          const hasSignal = age !== null && age <= 30;
          return (
            <li
              key={player.playerId}
              className="flex items-center justify-between border-b border-hairline pb-1 text-[14px] last:border-0 last:pb-0"
            >
              <span className="font-medium">{player.callSign}</span>
              <span className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-[2px] text-[10px] uppercase tracking-[0.14em] ${
                    player.briefedAt === null
                      ? "bg-amber-100 text-amber-900"
                      : "bg-emerald-100 text-emerald-900"
                  }`}
                >
                  {player.briefedAt === null ? "Rules" : "Rules ✓"}
                </span>
                {reportsPositions && (
                  <span
                    className={`text-[11px] ${
                      hasSignal
                        ? "text-muted-foreground"
                        : "font-semibold text-destructive"
                    }`}
                  >
                    {signalLabel(last)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {isOrganiser && canPause && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={busy}
            className="h-11 uppercase tracking-[0.18em]"
            onClick={() =>
              run(
                () =>
                  view.paused
                    ? resume({
                        matchId: view.matchId as Id<"matches">,
                        reason: "Resumed by the organiser.",
                      })
                    : pause({
                        matchId: view.matchId as Id<"matches">,
                        reason: "Paused by the organiser.",
                      }),
                "Could not pause or resume.",
              )
            }
          >
            {view.paused ? "Resume" : "Pause"}
          </Button>
        )}

        {isOrganiser && canPause && !endConfirm && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={busy}
            className="h-11 uppercase tracking-[0.18em]"
            onClick={() => setEndConfirm(true)}
          >
            End match
          </Button>
        )}

        {isOrganiser && endConfirm && (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted-foreground">
              End now? Bonuses are settled as usual.
            </span>
            <Button
              type="button"
              size="lg"
              disabled={busy}
              className="h-11 uppercase tracking-[0.18em]"
              onClick={() =>
                void run(async () => {
                  await end({
                    matchId: view.matchId as Id<"matches">,
                    reason: "Ended by the organiser.",
                  });
                  setEndConfirm(false);
                }, "Could not end the match.")
              }
            >
              Yes, end
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="h-11 uppercase tracking-[0.18em]"
              onClick={() => setEndConfirm(false)}
            >
              Cancel
            </Button>
          </span>
        )}

        {canAbort && !abortOpen && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={busy}
            className="h-11 uppercase tracking-[0.18em] text-destructive hover:text-destructive"
            onClick={() => setAbortOpen(true)}
          >
            Abort match
          </Button>
        )}

        {canAbort && abortOpen && (
          <span className="grid w-full gap-2">
            <label className="text-[13px] text-muted-foreground">
              Reason (required) — no winner, no bonuses, points already earned
              are kept.
            </label>
            <span className="flex flex-wrap gap-2">
              <Input
                value={reason}
                placeholder="Why is this being aborted?"
                onChange={(event) => setReason(event.target.value)}
                className="max-w-sm"
              />
              <Button
                type="button"
                size="lg"
                disabled={busy || reason.trim().length === 0}
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() =>
                  void run(async () => {
                    await abort({
                      matchId: view.matchId as Id<"matches">,
                      reason: reason.trim(),
                    });
                    setAbortOpen(false);
                    setReason("");
                  }, "Could not abort the match.")
                }
              >
                Abort
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() => setAbortOpen(false)}
              >
                Cancel
              </Button>
            </span>
          </span>
        )}
      </div>
    </section>
  );
}
