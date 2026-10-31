import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import type { MapView } from "@/server/positionService";

/**
 * The setup countdown (Stage 5 add-on, condition 1).
 *
 * The clock, the zone and the scoring are stopped; everyone is walking to a
 * starting position. Each player gets a ring that turns green when they are
 * far enough from everybody — and red with a distance when they are not. No
 * name, no role and no position of the other player is ever shown: only how
 * far away they are.
 *
 * Organiser and invigilators get the list of who is standing too close, and
 * the two buttons the rules allow when the countdown runs out: extend by one
 * minute, or start the head start anyway with a confirmation.
 */
export function SetupPanel(props: {
  view: MapView;
  matchId: Id<"matches">;
  nowMs: number;
}) {
  const { view, matchId, nowMs } = props;
  const setup = view.setup;
  const extend = useMutation(api.rooms.extendSetupRoom);
  const begin = useMutation(api.rooms.beginHeadStartRoom);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmForce, setConfirmForce] = useState(false);

  if (!setup.active) return null;

  const separation = setup.separation;
  const clear = separation !== null && separation.ok && !separation.waiting;
  const secondsLeft = Math.max(
    0,
    Math.ceil(((setup.endsAt ?? nowMs) - nowMs) / 1000),
  );
  const staff = view.staff !== null;
  const isOrganiser = view.me.isOrganiser;

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

  return (
    <section className="rounded-xl border-2 border-foreground/70 bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Setup period
        </p>
        <p className="font-display text-3xl tabular-nums">
          {Math.floor(secondsLeft / 60)}:
          {String(secondsLeft % 60).padStart(2, "0")}
        </p>
      </div>

      <p className="mt-2 text-[15px] leading-relaxed">
        Everyone to your starting position. The clock, the zone and the scoring
        are stopped — pings start when the head start begins.
      </p>

      {/* ---- The ring ---------------------------------------------------- */}
      <div className="mt-4 flex flex-col items-center gap-3">
        <div
          className={`flex h-44 w-44 items-center justify-center rounded-full border-[10px] text-center ${
            clear
              ? "border-emerald-500 bg-emerald-50"
              : separation?.waiting
                ? "border-muted-foreground/40 bg-muted"
                : "border-destructive bg-destructive/10"
          }`}
          role="status"
          aria-live="polite"
        >
          {separation?.waiting ? (
            <span className="px-4 text-[15px] font-semibold text-muted-foreground">
              Waiting for a
              <br />
              position…
            </span>
          ) : clear ? (
            <span className="px-4 text-[18px] font-bold text-emerald-800">
              Far enough
              <br />
              apart
            </span>
          ) : (
            <span className="px-4 text-[17px] font-bold text-destructive">
              Move away
              <br />
              <span className="text-[26px] tabular-nums">
                {separation?.distanceMetres ?? "?"} m
              </span>
              <br />
              <span className="text-[12px] font-medium">
                needed {separation?.requiredMetres ?? ""} m
              </span>
            </span>
          )}
        </div>
        <p className="text-[13px] text-muted-foreground">
          {clear
            ? "You are far enough from everyone."
            : "Distances only — nobody's name or position is shared."}
        </p>
      </div>

      {/* ---- Staff: who is too close ------------------------------------- */}
      {staff && (
        <div className="mt-4 rounded-lg border border-hairline p-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Still too close
          </p>
          {setup.issues.length === 0 && setup.waiting.length === 0 ? (
            <p className="mt-2 text-[14px] text-emerald-700">
              Everyone is clear.
            </p>
          ) : (
            <ul className="mt-2 grid gap-1 text-[14px]">
              {setup.issues.map((issue) => (
                <li key={`${issue.aId}-${issue.bId}`}>
                  {issue.aCallSign} ↔ {issue.bCallSign} — {issue.distanceMetres}{" "}
                  m (need {issue.requiredMetres} m)
                </li>
              ))}
              {setup.waiting.length > 0 && (
                <li className="text-muted-foreground">
                  No position yet: {setup.waiting.join(", ")}
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}

      {isOrganiser && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={busy}
            className="h-11 uppercase tracking-[0.18em]"
            onClick={() =>
              void run(
                () => extend({ matchId }),
                "Could not extend the setup period.",
              )
            }
          >
            Extend 1 min
          </Button>

          {!confirmForce ? (
            <Button
              type="button"
              size="lg"
              disabled={busy}
              className="h-11 uppercase tracking-[0.18em]"
              onClick={() => {
                setBusy(true);
                setError(null);
                void begin({ matchId })
                  .catch((cause: unknown) => {
                    const message =
                      cause instanceof Error ? cause.message : "Could not start.";
                    // The server counts the pairs that are still too close:
                    // offer the confirmation the rules require.
                    if (message.includes("too close")) setConfirmForce(true);
                    else setError(message);
                  })
                  .finally(() => setBusy(false));
              }}
            >
              Start the head start
            </Button>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-muted-foreground">
                Some players are still too close. Start anyway?
              </span>
              <Button
                type="button"
                size="lg"
                disabled={busy}
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() =>
                  void run(async () => {
                    await begin({ matchId, force: true });
                    setConfirmForce(false);
                  }, "Could not start the head start.")
                }
              >
                Yes, start anyway
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() => setConfirmForce(false)}
              >
                Cancel
              </Button>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
