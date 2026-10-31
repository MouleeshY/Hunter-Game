import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { BRIEFING } from "@/rules/briefing";

/**
 * The rules briefing (Stage 5, task 1).
 *
 * Every player reads this before the head start and taps "I understand". The
 * organiser cannot start until everyone has, unless they force it. The words
 * live in `src/rules/briefing.ts` — one file to edit.
 */
export function Briefing(props: {
  matchId: Id<"matches"> | null;
  confirmedAt: number | null;
  onConfirmed?: () => void;
}) {
  const { matchId, confirmedAt, onConfirmed } = props;
  const acknowledge = useMutation(api.rooms.acknowledgeBriefing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(confirmedAt === null);

  const confirm = async () => {
    if (!matchId) return;
    setBusy(true);
    setError(null);
    try {
      await acknowledge({ matchId });
      setOpen(false);
      onConfirmed?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border-2 border-foreground/70 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Rules briefing
          </p>
          <h2 className="mt-1 font-display text-2xl tracking-tight">
            {BRIEFING.title}
          </h2>
        </div>
        {confirmedAt !== null && (
          <span className="rounded-full border border-emerald-600 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-emerald-700">
            Confirmed
          </span>
        )}
      </div>

      {open ? (
        <>
          <p className="mt-3 text-[15px] leading-relaxed text-foreground/90">
            {BRIEFING.intro}
          </p>

          <div className="mt-4 grid gap-4">
            {BRIEFING.sections.map((section) => (
              <div key={section.heading}>
                <h3 className="text-[13px] uppercase tracking-[0.16em]">
                  {section.heading}
                </h3>
                <ul className="mt-1 grid gap-1">
                  {section.lines.map((line) => (
                    <li
                      key={line}
                      className="text-[14px] leading-relaxed text-foreground/85"
                    >
                      · {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="mt-4 rounded-lg border-2 border-foreground/60 p-3 text-[14px] font-semibold leading-relaxed">
            {BRIEFING.safety}
          </p>

          {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}

          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              type="button"
              size="lg"
              disabled={busy || !matchId}
              className="h-12 flex-1 uppercase tracking-[0.18em]"
              onClick={() => void confirm()}
            >
              {BRIEFING.acknowledgeLabel}
            </Button>
          </div>
        </>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] text-muted-foreground">
            You confirmed the rules. You can read them again at any time.
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-9 uppercase tracking-[0.18em]"
            onClick={() => setOpen(true)}
          >
            Read again
          </Button>
        </div>
      )}
    </section>
  );
}
