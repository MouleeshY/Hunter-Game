import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { PlayerMode } from "@/rules/types";
import { Button } from "@/components/ui/button";

const OPTIONS: {
  mode: PlayerMode;
  title: string;
  blurb: string;
}[] = [
  {
    mode: "spectator",
    title: "Spectator",
    blurb: "Stop playing and watch the rest of the match.",
  },
  {
    mode: "hunter",
    title: "Join the Hunters",
    blurb: "Run with the Hunters and scan codes. You earn no points.",
  },
  {
    mode: "helper",
    title: "Helper",
    blurb: "Stick with one Hunter for fun and earn no points. Your help is recorded when a capture happens.",
  },
];

/**
 * The choice a captured Shadow makes at the moment of capture: Spectator,
 * join the Hunters, or Helper. The organiser's preset arrives as the default,
 * and the choice is recorded on the player the moment they tap.
 */
export function CaptureChoice({
  matchId,
  defaultMode,
  onChosen,
}: {
  matchId: string;
  defaultMode: PlayerMode;
  onChosen: () => void;
}) {
  const choose = useMutation(api.matches.chooseCaptureMode);
  const [selected, setSelected] = useState<PlayerMode>(defaultMode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await choose({
        matchId: matchId as Id<"matches">,
        mode: selected,
      });
      onChosen();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-foreground/20 p-6">
      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        You have been caught
      </p>
      <h2 className="mt-2 font-display text-2xl tracking-tight">
        What happens next?
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Your preset was <strong>{defaultMode}</strong>. Pick one — the organiser
        or an invigilator can change it later.
      </p>

      <div className="mt-5 grid gap-3">
        {OPTIONS.map((option) => {
          const active = option.mode === selected;
          return (
            <button
              key={option.mode}
              type="button"
              onClick={() => setSelected(option.mode)}
              className={`rounded-lg border p-4 text-left transition ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-hairline hover:border-foreground/30"
              }`}
            >
              <span className="block text-[15px]">{option.title}</span>
              <span
                className={`mt-1 block text-[12px] ${
                  active ? "text-background/70" : "text-muted-foreground"
                }`}
              >
                {option.blurb}
              </span>
            </button>
          );
        })}
      </div>

      {error && <p className="mt-3 text-[12px] text-destructive">{error}</p>}

      <div className="mt-5 flex justify-end">
        <Button
          type="button"
          disabled={busy}
          className="h-11 uppercase tracking-[0.18em]"
          onClick={() => void submit()}
        >
          {busy ? "Saving…" : "Confirm"}
        </Button>
      </div>
    </div>
  );
}
