import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

/**
 * "Shadow won't show code".
 *
 * The Hunter picks the Shadow from the list of active Shadows — never a typed
 * id. The server applies the filing window, the one-open-complaint-per-pair
 * rule and the per-Hunter rate limit, and every invigilator sees it in the
 * console with a response countdown.
 */
export function ComplaintForm({
  matchId,
  onClose,
  onFiled,
}: {
  matchId: string;
  onClose: () => void;
  onFiled: () => void;
}) {
  const targets = useQuery(api.complaints.complaintTargets, {
    matchId: matchId as Id<"matches">,
  });
  const file = useMutation(api.complaints.file);

  const [accusedId, setAccusedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!accusedId) return;
    setError(null);
    setBusy(true);
    try {
      await file({
        matchId: matchId as Id<"matches">,
        accusedId: accusedId as Id<"players">,
        incidentAtMs: Date.now(),
      });
      onFiled();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not file that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-hairline p-6">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Shadow won't show code
        </p>
        <button
          type="button"
          className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground underline underline-offset-4"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>

      {targets === undefined && (
        <p className="mt-4 text-[13px] text-muted-foreground">Loading…</p>
      )}

      {targets && !targets.isHunter && (
        <p className="mt-4 text-[13px] text-muted-foreground">
          Only Hunters can report a Shadow.
        </p>
      )}

      {targets && targets.isHunter && (
        <>
          <p className="mt-3 text-[13px] text-muted-foreground">
            Pick the Shadow who refused. An invigilator answers within the
            response limit and sees both positions.
          </p>

          <ul className="mt-4 grid gap-2">
            {targets.targets.length === 0 && (
              <li className="text-[13px] text-muted-foreground">
                No Shadows are in play right now.
              </li>
            )}
            {targets.targets.map(
              (target: (typeof targets.targets)[number]) => {
                const selected = target.playerId === accusedId;
                return (
                <li key={target.playerId}>
                  <button
                    type="button"
                    disabled={target.alreadyReported}
                    onClick={() => setAccusedId(target.playerId)}
                    className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-[14px] transition ${
                      selected
                        ? "border-foreground bg-foreground text-background"
                        : "border-hairline hover:border-foreground/30"
                    } ${target.alreadyReported ? "opacity-50" : ""}`}
                  >
                    <span>{target.callSign}</span>
                    {target.alreadyReported && (
                      <span className="text-[10px] uppercase tracking-[0.16em]">
                        Reported
                      </span>
                    )}
                  </button>
                </li>
              );
              },
            )}
          </ul>

          {error && <p className="mt-3 text-[12px] text-destructive">{error}</p>}

          <div className="mt-5 flex justify-end">
            <Button
              type="button"
              disabled={!accusedId || busy}
              className="h-11 uppercase tracking-[0.18em]"
              onClick={() => void submit()}
            >
              {busy ? "Filing…" : "File complaint"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
