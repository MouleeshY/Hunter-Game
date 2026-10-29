import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { RULES_CONFIG } from "@/convex/rules/config";

/**
 * The real match flow (create/join a room, the lobby, teams) is Stage 2.
 * Stage 1 shipped the rules engine and the data model behind it, so this route
 * states that plainly instead of quietly running the old bot demo.
 */
export default function Play() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-clay" />
            <span className="font-display text-[15px] tracking-tight">Shadow Hunt</span>
          </Link>
          <Link
            to="/"
            className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Landing
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
          Stage 1 · rules engine
        </p>
        <h1 className="mt-4 max-w-2xl font-display text-5xl leading-[1.03] tracking-tight sm:text-7xl">
          Match rooms open in <span className="italic text-clay">Stage 2.</span>
        </h1>
        <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          The rules are now real and server-side: team roles, the 5-minute head
          start, 3-minute pings, the shrinking play area, the 40&nbsp;m tag check,
          complaints, out-of-zone grace and every scoring number. Creating a room
          and gathering the crew comes next.
        </p>

        <dl className="mt-10 grid grid-cols-2 border-t border-hairline sm:grid-cols-4">
          {[
            { figure: `${RULES_CONFIG.headStartMinutes} min`, label: "Shadow head start" },
            { figure: `${RULES_CONFIG.pingIntervalMinutes} min`, label: "Ping interval" },
            { figure: `${RULES_CONFIG.tagProximityMetres} m`, label: "Tag proximity" },
            {
              figure: `${RULES_CONFIG.eventWindowMinutes.min}–${RULES_CONFIG.eventWindowMinutes.max}`,
              label: "Event window (min)",
            },
          ].map((item) => (
            <div
              key={item.label}
              className="border-b border-hairline py-4 pr-4 sm:border-b-0"
            >
              <dt className="font-display text-2xl tabular-nums">{item.figure}</dt>
              <dd className="mt-1 text-[12px] leading-snug text-muted-foreground">
                {item.label}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild size="lg" className="h-11 uppercase tracking-[0.18em]">
            <Link to="/demo">Try the solo demo</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-11 uppercase tracking-[0.18em]"
          >
            <Link to="/">Back to landing</Link>
          </Button>
        </div>

        <p className="mt-6 max-w-xl text-[12px] leading-relaxed text-muted-foreground">
          The solo demo still runs on the old bot simulation. It lives behind{" "}
          <span className="font-mono text-ink">/demo</span> and is clearly marked
          as demo code — it is not part of the product flow.
        </p>
      </main>
    </div>
  );
}
