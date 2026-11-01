import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import type { MapView } from "@/server/positionService";
import type { PlayerResult } from "@/server/results";

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

const BREAKDOWN: { key: "alive" | "tags" | "bonuses" | "drains"; label: string }[] =
  [
    { key: "alive", label: "Alive minutes" },
    { key: "tags", label: "Tags" },
    { key: "bonuses", label: "Bonuses" },
    { key: "drains", label: "Zone drain" },
  ];

/**
 * The frozen end-of-match screen (Stage 5, task 7; Stage 6, task 5).
 *
 * Everything else on the page is replaced by this once the match is over:
 * uploads have stopped, the GPS watch is released and the wake lock is gone by
 * the time you see it. The who-caught-whom list below is for this match's
 * players only — it is never part of the public result.
 */
export function MatchEnded(props: {
  view: MapView;
  result: PlayerResult | null;
  onBack: () => void;
}) {
  const { view, result } = props;
  const summary = winnerLine(view);
  const myRole = view.me.role === "hunter" ? "Hunter" : "Shadow";

  return (
    <section className="rounded-xl border-2 border-foreground bg-card p-6">
      <div className="text-center">
        <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
          {result?.title ?? `Room ${view.roomCode}`}
        </p>

        <h2 className="mt-3 font-display text-4xl tracking-tight">
          {summary.headline}
        </h2>
        {summary.detail && (
          <p className="mt-2 text-[15px] text-muted-foreground">
            {summary.detail}
          </p>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
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
          <div className="rounded-lg border border-hairline p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Your rank
            </p>
            <p className="mt-1 font-display text-2xl tabular-nums">
              {result?.rank === null || result?.rank === undefined
                ? "—"
                : `#${result.rank} of ${result.totalPlayers}`}
            </p>
          </div>
        </div>
      </div>

      {result && (
        <>
          <div className="mt-6 rounded-lg border border-hairline p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              How your points were earned
            </p>
            <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {BREAKDOWN.map((line) => (
                <div
                  key={line.key}
                  className="flex items-baseline justify-between gap-3 border-b border-hairline pb-1 last:border-0"
                >
                  <dt className="text-[13px] text-muted-foreground">
                    {line.label}
                  </dt>
                  <dd className="text-[14px] font-medium tabular-nums">
                    {result.breakdown[line.key]}
                  </dd>
                </div>
              ))}
              {result.minutesSurvived !== null && (
                <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-1 last:border-0">
                  <dt className="text-[13px] text-muted-foreground">
                    Time survived
                    <span className="block text-[11px] text-muted-foreground/70">
                      after the head start
                    </span>
                  </dt>
                  <dd className="text-[14px] font-medium tabular-nums">
                    {result.minutesSurvived} min
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="mt-4 rounded-lg border border-hairline p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Who caught whom
            </p>
            {result.catches.length === 0 ? (
              <p className="mt-2 text-[14px] text-muted-foreground">
                No Shadow was caught in this match.
              </p>
            ) : (
              <ul className="mt-2 max-h-56 overflow-y-auto">
                {result.catches.map((line, index) => (
                  <li
                    key={`${line.at}-${index}`}
                    className="flex items-baseline gap-3 border-b border-hairline py-1 text-[14px] last:border-0"
                  >
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {new Date(line.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span>
                      {line.hunterName} caught {line.shadowName}
                      {line.forced ? " (forced by staff)" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              Only the players of this match see this list. It is never part of
              the public result.
            </p>
          </div>
        </>
      )}

      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        Positions from this match are deleted{" "}
        {view.config.positionRetentionHours} hours after the end. Scores are
        kept.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {result?.publicSlug && (
          <Button asChild size="lg" className="h-11 uppercase tracking-[0.18em]">
            <Link to={`/results/${result.publicSlug}`}>Public result</Link>
          </Button>
        )}
        <Button
          type="button"
          size="lg"
          variant={result?.publicSlug ? "outline" : "default"}
          className="h-11 uppercase tracking-[0.18em]"
          onClick={props.onBack}
        >
          Back to rooms
        </Button>
      </div>
    </section>
  );
}
