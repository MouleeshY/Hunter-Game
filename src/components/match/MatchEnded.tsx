import { Button } from "@/components/ui/button";
import type { MapView } from "@/server/positionService";

function winnerLine(view: MapView): { headline: string; detail: string } {
  if (view.endReason === "aborted") {
    return {
      headline: "Match aborted",
      detail: "Staff stopped the match, so no winner was declared.",
    };
  }
  if (view.winner === null) {
    return { headline: "Match ended", detail: "" };
  }
  return view.winner === "hunters"
    ? {
        headline: "Hunters win",
        detail: "No Shadow was left in play.",
      }
    : {
        headline: "Shadows win",
        detail: "The timer ran out with a Shadow still free.",
      };
}

/**
 * The frozen end-of-match screen (Stage 5, task 7). Everything else on the
 * page is replaced by this once the match is over: uploads have stopped, the
 * GPS watch is released and the wake lock is gone by the time you see it.
 */
export function MatchEnded(props: { view: MapView; onBack: () => void }) {
  const { view, onBack } = props;
  const result = winnerLine(view);
  const myRole = view.me.role === "hunter" ? "Hunter" : "Shadow";

  return (
    <section className="rounded-xl border-2 border-foreground bg-card p-6 text-center">
      <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
        Room {view.roomCode}
      </p>

      <h2 className="mt-3 font-display text-4xl tracking-tight">
        {result.headline}
      </h2>
      {result.detail && (
        <p className="mt-2 text-[15px] text-muted-foreground">{result.detail}</p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-hairline p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            You played
          </p>
          <p className="mt-1 font-display text-2xl">{myRole}</p>
        </div>
        <div className="rounded-lg border border-hairline p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Your points
          </p>
          <p className="mt-1 font-display text-2xl tabular-nums">
            {view.me.points}
          </p>
        </div>
      </div>

      <p className="mt-4 text-[13px] text-muted-foreground">
        Positions from this match are deleted{" "}
        {view.config.positionRetentionHours} hours after the end. Scores are
        kept.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button
          type="button"
          size="lg"
          className="h-11 uppercase tracking-[0.18em]"
          onClick={props.onBack}
        >
          Back to rooms
        </Button>
      </div>
    </section>
  );
}
