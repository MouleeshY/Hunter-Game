export interface FeedLine {
  id: string;
  at: number;
  kind: string;
  text: string;
}

/**
 * The live event feed (Stage 5, task 6).
 *
 * Tags, eliminations, shrinks and pauses only — never a position, and never
 * who caught whom until the match has ended (that is the Match End screen's
 * job).
 */
export function EventFeed(props: { items: FeedLine[]; ended: boolean }) {
  const recent = [...props.items].slice(-10).reverse();

  return (
    <section className="rounded-xl border border-hairline p-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        What has happened
      </p>

      {recent.length === 0 ? (
        <p className="mt-3 text-[14px] text-muted-foreground">
          Nothing yet. Tags, eliminations, shrinks and pauses show up here.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {recent.map((line) => (
            <li
              key={line.id}
              className="flex items-baseline gap-3 border-b border-hairline pb-2 last:border-0 last:pb-0"
            >
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {new Date(line.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="text-[14px] leading-snug">{line.text}</span>
            </li>
          ))}
        </ul>
      )}

      {!props.ended && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Who caught whom is revealed when the match is over.
        </p>
      )}
    </section>
  );
}
