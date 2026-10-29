import { useEffect, useRef, useState } from "react";
import { Radar } from "@/demo/Radar";
import { Results } from "@/demo/Results";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  DETECT_RANGE,
  MATCH_MS,
  PING_MS,
  TICK_MS,
  TIME_SCALE,
  ZONE_CENTER,
  ZONE_MS,
  aliveShadows,
  createGame,
  distance,
  formatClock,
  isRevealed,
  setDestination,
  stepGame,
  taggable,
  tryTag,
  you,
  type GameState,
  type RosterEntry,
} from "@/demo/game";

interface ArenaProps {
  code: string;
  playerName: string;
  roster: RosterEntry[];
  seed: number;
  onLeave: () => void;
  onRoom: () => void;
  onRematch: () => void;
}

function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`border border-hairline bg-card ${className}`}>
      <h2 className="border-b border-hairline px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h2>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

function Meter({
  label,
  value,
  total,
}: {
  label: string;
  value: string;
  total: number;
}) {
  const pct = Math.max(0, Math.min(1, 1 - total));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <span className="font-mono text-sm tabular-nums">{value}</span>
      </div>
      <div className="mt-1.5 h-px w-full bg-hairline">
        <div
          className="h-px bg-ink/70 transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}

export function Arena({
  code,
  playerName,
  roster,
  seed,
  onLeave,
  onRoom,
  onRematch,
}: ArenaProps) {
  const isMobile = useIsMobile();
  const [state, setState] = useState<GameState>(() =>
    createGame(playerName, roster, seed),
  );
  const [countdown, setCountdown] = useState(3);
  const tag = taggable(state);
  const tagRef = useRef(tag);
  const countdownRef = useRef(countdown);

  /* keep the key handler in sync without resubscribing every tick */
  useEffect(() => {
    tagRef.current = tag;
    countdownRef.current = countdown;
  }, [tag, countdown]);

  /* pre-match 3 · 2 · 1 */
  useEffect(() => {
    if (countdown <= 0) return;
    const id = window.setTimeout(() => setCountdown((c) => c - 1), 750);
    return () => window.clearTimeout(id);
  }, [countdown]);

  /* the clock: game rules in game time, rendered at demo speed */
  useEffect(() => {
    if (countdown > 0 || state.phase === "ended") return;
    const dt = TICK_MS * TIME_SCALE;
    const id = window.setInterval(
      () => setState((s) => stepGame(s, dt, TICK_MS)),
      TICK_MS,
    );
    return () => window.clearInterval(id);
  }, [countdown, state.phase]);

  /* space bar tags */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !tagRef.current || countdownRef.current > 0)
        return;
      e.preventDefault();
      setState((s) => tryTag(s));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const me = you(state);
  const reveal = isRevealed(state);
  const alive = aliveShadows(state);
  const tagged = state.taggedCount;
  const remaining = MATCH_MS - state.elapsed;
  const nextPing = Math.max(0, state.nextPingAt - state.elapsed);
  const nextZone = Math.max(0, state.zone.nextAt - state.elapsed);
  const zoneFinal = state.zone.shrinks >= 2;
  const outside =
    distance(me.x, me.y, ZONE_CENTER.x, ZONE_CENTER.y) > state.zone.r;

  const rosterRows = state.agents.map((a) => {
    if (a.team === "hunter") {
      return {
        id: a.id,
        name: a.name,
        you: a.you,
        detail: a.you
          ? "you"
          : `${Math.round(distance(me.x, me.y, a.x, a.y))} m away`,
        state: "live" as const,
      };
    }
    if (!a.alive) {
      return {
        id: a.id,
        name: a.name,
        you: false,
        detail: `tagged by ${a.taggedBy}`,
        state: "down" as const,
      };
    }
    const ghost = state.ghosts[a.id];
    const live = reveal || distance(me.x, me.y, a.x, a.y) <= DETECT_RANGE;
    if (!ghost) {
      return {
        id: a.id,
        name: a.name,
        you: false,
        detail: "no signal",
        state: "lost" as const,
      };
    }
    const age = Math.floor((state.elapsed - ghost.at) / 1000);
    return {
      id: a.id,
      name: a.name,
      you: false,
      detail: live
        ? `${Math.round(distance(me.x, me.y, a.x, a.y))} m · live`
        : `last ping ${age}s ago · ${Math.round(distance(me.x, me.y, ghost.x, ghost.y))} m`,
      state: live ? ("live" as const) : ("ghost" as const),
    };
  });

  if (state.phase === "ended") {
    return (
      <Results
        state={state}
        code={code}
        onRematch={onRematch}
        onRoom={onRoom}
        onLeave={onLeave}
      />
    );
  }

  return (
    <div className="min-h-screen">
      {/* top rail */}
      <header className="sticky top-0 z-20 border-b border-hairline bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <button
            type="button"
            onClick={onLeave}
            className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Leave
          </button>
          <div className="hidden font-mono text-[11px] tracking-[0.28em] text-muted-foreground sm:block">
            ROOM {code}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden border border-hairline px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:inline">
              clock ×{TIME_SCALE}
            </span>
            <span className="font-mono text-xl tabular-nums tracking-tight">
              {formatClock(remaining)}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0">
          {/* radar */}
          <div className="relative aspect-square w-full border border-hairline bg-paper">
            <Radar
              state={state}
              interactive={countdown === 0}
              compact={!!isMobile}
              onMove={(x, y) => setState((s) => setDestination(s, x, y))}
            />

            <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-2">
              <span
                className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${
                  reveal
                    ? "border-ochre/60 bg-ochre/15 text-ink"
                    : "border-hairline bg-background/80 text-muted-foreground"
                }`}
              >
                {reveal
                  ? `signal live · ${alive.length} contact${alive.length === 1 ? "" : "s"}`
                  : "scanning"}
              </span>
              {outside && (
                <span className="border border-clay/60 bg-clay/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-clay">
                  outside the area — return
                </span>
              )}
            </div>

            {countdown > 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-paper/92 text-center">
                <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                  Match starts in
                </p>
                <p className="font-display text-8xl leading-none">
                  {countdown}
                </p>
                <p className="mt-3 max-w-xs text-sm text-muted-foreground">
                  You&apos;re on the Hunters. Tap the plan to move, tag a shadow
                  when it&apos;s close.
                </p>
              </div>
            )}
          </div>

          {/* controls */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="lg"
              disabled={!tag || countdown > 0}
              onClick={() => setState((s) => tryTag(s))}
              className={`h-12 flex-1 min-w-[220px] text-[13px] uppercase tracking-[0.18em] ${
                tag
                  ? "bg-clay text-white hover:bg-clay/90"
                  : "border border-hairline bg-transparent text-muted-foreground"
              }`}
            >
              {tag
                ? `Tag ${tag.agent.name} · ${Math.round(tag.dist)} m`
                : "Tag out of range"}
            </Button>
            <p className="text-[13px] text-muted-foreground">
              Tap the plan to move ·{" "}
              <kbd className="font-mono text-ink">space</kbd> to tag
            </p>
          </div>
        </div>

        {/* right rail */}
        <aside className="flex flex-col gap-4">
          <Panel title="Objective">
            <p className="font-display text-xl leading-snug">
              Tag every shadow before the clock runs out.
            </p>
            <div className="mt-3 flex items-center gap-2">
              {state.agents
                .filter((a) => a.team === "shadow")
                .map((a) => (
                  <span
                    key={a.id}
                    className={`h-2 flex-1 ${
                      a.alive ? "bg-clay/30" : "bg-ink"
                    }`}
                  />
                ))}
              <span className="ml-1 font-mono text-xs text-muted-foreground">
                {tagged}/3
              </span>
            </div>
          </Panel>

          <Panel title="Clock">
            <div className="space-y-4">
              <Meter
                label="Next radar pulse"
                value={formatClock(nextPing)}
                total={nextPing / PING_MS}
              />
              <Meter
                label={zoneFinal ? "Zone" : "Zone contracts in"}
                value={zoneFinal ? "final" : formatClock(nextZone)}
                total={zoneFinal ? 1 : nextZone / ZONE_MS}
              />
            </div>
          </Panel>

          <Panel title={`Players · ${state.agents.length}`}>
            <ul className="space-y-2.5">
              {rosterRows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="flex items-center gap-2 truncate">
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${
                        row.state === "down"
                          ? "bg-ink/25"
                          : row.state === "live"
                            ? "bg-clay"
                            : "bg-clay/40"
                      }`}
                    />
                    <span
                      className={`truncate text-sm ${
                        row.state === "down"
                          ? "text-muted-foreground line-through"
                          : row.you
                            ? "font-medium"
                            : ""
                      }`}
                    >
                      {row.name}
                    </span>
                    {row.you && (
                      <span className="border border-hairline px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                        hunter
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {row.detail}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Feed">
            <ul className="space-y-2">
              {state.logs
                .slice(-5)
                .reverse()
                .map((entry) => (
                  <li
                    key={entry.id}
                    className="flex gap-2 text-[13px] leading-snug"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {formatClock(MATCH_MS - entry.at)}
                    </span>
                    <span
                      className={
                        entry.kind === "tag"
                          ? "text-ink"
                          : entry.kind === "pulse"
                            ? "text-ink/80"
                            : "text-muted-foreground"
                      }
                    >
                      {entry.text}
                    </span>
                  </li>
                ))}
            </ul>
          </Panel>
        </aside>
      </main>
    </div>
  );
}
