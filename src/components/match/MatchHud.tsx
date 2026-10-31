import type { MapView } from "@/server/positionService";

export function formatCountdown(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${two(minutes)}:${two(seconds)}`
    : `${minutes}:${two(seconds)}`;
}

function Cell(props: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-hairline px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {props.label}
      </p>
      <p className="font-display text-[26px] leading-tight tabular-nums">
        {props.value}
      </p>
      {props.sub && (
        <p className="text-[11px] leading-tight text-muted-foreground">
          {props.sub}
        </p>
      )}
    </div>
  );
}

function phaseLabel(view: MapView): string {
  if (view.paused) return "Paused";
  if (view.status === "setup") return "Setup";
  if (view.status === "headstart") return "Head start";
  if (view.status === "live") return "Live";
  if (view.status === "ended") return "Match ended";
  return "Waiting";
}

/**
 * The match HUD (Stage 5, task 3): one bar with the clock, the phase, the next
 * ping, the next shrink and the zone — then whatever that role needs to know.
 * Large type and hard contrast, because it is read outdoors in daylight.
 */
export function MatchHud(props: { view: MapView; nowMs: number }) {
  const { view, nowMs } = props;
  const config = view.config;
  const me = view.me;

  const clockTo =
    view.status === "setup"
      ? view.setup.endsAt
      : view.status === "headstart"
        ? view.headStartEndsAt
        : view.status === "live"
          ? view.endsAt
          : null;
  const clockLabel =
    view.status === "setup"
      ? "Setup ends in"
      : view.status === "headstart"
        ? "Live in"
        : view.status === "live"
          ? "Time left"
          : "Finished";

  const aliveSince = view.headStartEndsAt ?? view.startedAt;
  const survivedMs =
    aliveSince === null ? 0 : Math.max(0, nowMs - aliveSince);
  const survived = `${Math.floor(survivedMs / 60_000)}m ${Math.floor(
    (survivedMs % 60_000) / 1000,
  )}s`;

  const outside = me.breach !== null && me.breach.status !== "inside";

  return (
    <section className="rounded-xl border-2 border-foreground/70 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-[12px] font-bold uppercase tracking-[0.18em] ${
              view.paused
                ? "bg-amber-500 text-black"
                : view.status === "live"
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground"
            }`}
          >
            {phaseLabel(view)}
          </span>
          <span className="text-[13px] uppercase tracking-[0.16em] text-muted-foreground">
            {view.roomCode}
            {me.callSign ? ` · ${me.callSign}` : ""}
          </span>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {view.paused ? "Clock frozen" : "On the server clock"}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label={clockLabel} value={formatCountdown(clockTo === null ? null : clockTo - nowMs)} />
        <Cell
          label="Next ping"
          value={formatCountdown(
            view.ping.nextPingAtMs === null
              ? null
              : view.ping.nextPingAtMs - nowMs,
          )}
          sub={`${config.pingIntervalMinutes} min apart`}
        />
        <Cell
          label="Next shrink"
          value={formatCountdown(
            view.zone.nextShrinkAtMs === null
              ? null
              : view.zone.nextShrinkAtMs - nowMs,
          )}
          sub={`${config.zoneShrinkIntervalMinutes} min steps`}
        />
        <Cell
          label="Zone"
          value={`${Math.round(view.zone.radiusMetres)} m`}
          sub={
            outside
              ? "You are OUT — get back in"
              : view.status === "live"
                ? "You are inside"
                : "Starting radius"
          }
        />
      </div>

      {/* ---- Role-specific ------------------------------------------------ */}
      <div className="mt-3 rounded-lg border border-hairline p-3">
        {me.role === "shadow" && me.status === "active" && (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[20px] font-semibold">
              Your score: {me.points} points
            </p>
            <p className="text-[15px] text-muted-foreground">
              Surviving for {survived}
            </p>
          </div>
        )}

        {me.role === "hunter" && me.status === "active" && (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[20px] font-semibold">
              Tags: {view.summary.tags} · {view.summary.activeShadows} of{" "}
              {view.summary.totalShadows} Shadows still free
            </p>
            <p className="text-[15px] text-muted-foreground">
              Team bonus: +{config.allTaggedBonusPerHunter} per Hunter when the
              last Shadow is caught
            </p>
          </div>
        )}

        {!(
          (me.role === "shadow" && me.status === "active") ||
          (me.role === "hunter" && me.status === "active")
        ) && (
          <div>
            <p className="text-[17px] font-semibold">
              Still in: {view.summary.activeShadows} Shadow
              {view.summary.activeShadows === 1 ? "" : "s"} ·{" "}
              {view.summary.activeHunters} Hunter
              {view.summary.activeHunters === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-[14px] text-muted-foreground">
              {view.summary.stillIn.length === 0
                ? "Nobody is in play."
                : view.summary.stillIn.map((player) => player.callSign).join(" · ")}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
