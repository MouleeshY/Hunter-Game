import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  MATCH_MS,
  SHADOWS,
  TIME_SCALE,
  formatClock,
  msToGameMinutes,
  TOTAL_PLAYERS,
  type GameState,
} from "@/lib/game";

interface ResultsProps {
  state: GameState;
  code: string;
  onRematch: () => void;
  onRoom: () => void;
  onLeave: () => void;
}

const stats = (state: GameState) => {
  const tagged = state.taggedCount;
  return [
    { label: "Total players", value: String(state.agents.length || TOTAL_PLAYERS) },
    { label: "Shadows tagged", value: String(tagged) },
    { label: "Shadows survived", value: String(SHADOWS - tagged) },
    { label: "Radar pulses fired", value: String(state.pulses) },
  ];
};

const secondary = (state: GameState) => [
  { label: "Tags by you", value: String(state.yourTags) },
  { label: "Zone contractions", value: String(state.zone.shrinks) },
  {
    label: "Match length",
    value: `${msToGameMinutes(state.elapsed)} min`,
  },
  { label: "Clock speed", value: `×${TIME_SCALE}` },
];

export function Results({ state, code, onRematch, onRoom, onLeave }: ResultsProps) {
  const huntersWon = state.result === "hunters";
  const tagged = state.taggedCount;
  const myName = state.agents.find((a) => a.you)?.name;

  return (
    <div className="min-h-screen">
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <span className="font-mono text-[11px] tracking-[0.28em] text-muted-foreground">
            ROOM {code}
          </span>
          <button
            type="button"
            onClick={onLeave}
            className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Leave
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
            Match stats · complete
          </p>
          <h1 className="mt-4 font-display text-5xl leading-[1.05] tracking-tight sm:text-7xl">
            {huntersWon ? (
              <>
                Hunters <span className="italic text-clay">win.</span>
              </>
            ) : (
              <>
                Shadows <span className="italic text-clay">survive.</span>
              </>
            )}
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            {huntersWon
              ? `Every shadow was run down and tagged inside ${msToGameMinutes(state.elapsed)} minutes. The plan closed in with ${formatClock(MATCH_MS - state.elapsed)} still on the clock.`
              : `${tagged} of ${SHADOWS} shadows were tagged. ${SHADOWS - tagged} stayed off the radar until the final whistle at ${formatClock(MATCH_MS - state.elapsed).replace(/^0:/, "0:0")}.`}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12, ease: "easeOut" }}
          className="mt-10 grid grid-cols-2 border-l border-t border-hairline sm:grid-cols-4"
        >
          {stats(state).map((s) => (
            <div key={s.label} className="border-b border-r border-hairline px-4 py-6">
              <p className="font-display text-4xl leading-none tabular-nums sm:text-5xl">
                {s.value}
              </p>
              <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {s.label}
              </p>
            </div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.22, ease: "easeOut" }}
          className="mt-10 grid gap-10 sm:grid-cols-2"
        >
          <div>
            <h2 className="border-b border-hairline pb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Also worth noting
            </h2>
            <ul className="mt-3 space-y-2">
              {secondary(state).map((s) => (
                <li
                  key={s.label}
                  className="flex items-baseline justify-between border-b border-hairline/60 pb-2 text-sm"
                >
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="font-mono tabular-nums">{s.value}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="border-b border-hairline pb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Who caught whom
            </h2>
            <ul className="mt-3 space-y-2">
              {state.agents
                .filter((a) => a.team === "shadow")
                .map((a) => (
                  <li
                    key={a.id}
                    className="flex items-baseline justify-between border-b border-hairline/60 pb-2 text-sm"
                  >
                    <span className={a.alive ? "text-muted-foreground" : ""}>{a.name}</span>
                    <span className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      {a.alive
                        ? "survived"
                        : a.taggedBy === myName
                          ? `tagged by you`
                          : `tagged by ${a.taggedBy}`}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.34 }}
          className="mt-12 flex flex-wrap gap-3"
        >
          <Button size="lg" onClick={onRematch} className="uppercase tracking-[0.16em]">
            Run it back
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={onRoom}
            className="uppercase tracking-[0.16em]"
          >
            Back to room
          </Button>
        </motion.div>
      </main>
    </div>
  );
}
