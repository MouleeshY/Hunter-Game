import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { TOTAL_PLAYERS, type RosterEntry } from "@/demo/game";

interface LobbyProps {
  code: string;
  roster: RosterEntry[];
  onStart: () => void;
  onBack: () => void;
}

export function Lobby({ code, roster, onStart, onBack }: LobbyProps) {
  const [joined, setJoined] = useState(1);

  useEffect(() => {
    if (joined >= roster.length) return;
    const id = window.setTimeout(() => setJoined((n) => n + 1), 620);
    return () => window.clearTimeout(id);
  }, [joined, roster.length]);

  const ready = joined >= roster.length;
  const teams: Array<"hunter" | "shadow"> = ["hunter", "shadow"];

  return (
    <div className="min-h-screen">
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <button
            type="button"
            onClick={onBack}
            className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back
          </button>
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Room
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
          Match lobby
        </p>
        <h1 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight sm:text-6xl">
          Send the code. <span className="italic">Wait for the crew.</span>
        </h1>

        <div className="mt-8 flex flex-col items-start justify-between gap-6 border border-hairline bg-card px-6 py-7 sm:flex-row sm:items-center">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Room code
            </p>
            <p className="mt-2 font-mono text-4xl tracking-[0.3em] sm:text-5xl">{code}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigator.clipboard?.writeText(code).catch(() => {})}
            >
              Copy code
            </Button>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {joined}/{TOTAL_PLAYERS} in
            </span>
          </div>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {teams.map((team) => {
            const members = roster
              .map((entry, index) => ({ entry, index }))
              .filter((m) => m.entry.team === team && m.index < joined);
            return (
              <section key={team} className="border border-hairline bg-card">
                <h2 className="flex items-baseline justify-between border-b border-hairline px-4 py-2.5">
                  <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {team === "hunter" ? "Hunters" : "Shadows"}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {members.length}
                  </span>
                </h2>
                <ul className="divide-y divide-hairline">
                  {members.map(({ entry, index }) => (
                    <motion.li
                      key={`${entry.name}-${index}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.35, ease: "easeOut" }}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <span
                          className={`size-1.5 rounded-full ${
                            team === "hunter" ? "bg-ink" : "bg-clay"
                          }`}
                        />
                        <span className="truncate text-[15px]">{entry.name}</span>
                        {index === 0 && (
                          <span className="border border-hairline px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                            you
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                        ready
                      </span>
                    </motion.li>
                  ))}
                  {members.length === 0 && (
                    <li className="px-4 py-3 text-sm text-muted-foreground">
                      Waiting for a shadow…
                    </li>
                  )}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="mt-8 flex flex-col items-start justify-between gap-4 border-t border-hairline pt-6 sm:flex-row sm:items-center">
          <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
            Five of these players are simulated for the demo — they run, hide and
            tag exactly like the real thing.
          </p>
          <Button
            type="button"
            size="lg"
            disabled={!ready}
            onClick={onStart}
            className="h-12 w-full uppercase tracking-[0.18em] sm:w-auto"
          >
            {ready ? "Start match" : `Waiting · ${joined}/${TOTAL_PLAYERS}`}
          </Button>
        </div>
      </main>
    </div>
  );
}
