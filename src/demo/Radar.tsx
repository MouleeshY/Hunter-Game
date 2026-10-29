import {
  WORLD,
  ZONE_CENTER,
  isLive,
  isRevealed,
  you,
  type GameState,
} from "@/demo/game";

/* ------------------------------------------------------------------ *
 * The plan view: a thin-lined city drawing with the radar laid over it.
 * ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
}

function buildPlan() {
  const rnd = mulberry32(20261029);
  const cut = (count: number) => {
    const gaps: number[] = [];
    let v = 40 + rnd() * 50;
    for (let i = 0; i < count; i++) {
      gaps.push(v);
      v += 78 + rnd() * 74;
    }
    gaps.push(WORLD - 24);
    return gaps;
  };

  const cols = cut(7);
  const rows = cut(7);
  const blocks: Block[] = [];

  for (let i = 0; i < cols.length - 1; i++) {
    for (let j = 0; j < rows.length - 1; j++) {
      if (rnd() < 0.22) continue; // open lots and yards
      const pad = 6 + rnd() * 7;
      const x = cols[i] + pad;
      const y = rows[j] + pad;
      const w = cols[i + 1] - cols[i] - pad * 2;
      const h = rows[j + 1] - rows[j] - pad * 2;
      if (w <= 6 || h <= 6) continue;
      blocks.push({ x, y, w, h });
    }
  }

  const streets = [
    ...cols.map((x) => ({
      x1: x,
      y1: -10,
      x2: x + (rnd() * 10 - 5),
      y2: WORLD + 10,
    })),
    ...rows.map((y) => ({
      x1: -10,
      y1: y,
      x2: WORLD + 10,
      y2: y + (rnd() * 10 - 5),
    })),
  ];

  return { blocks, streets };
}

const PLAN = buildPlan();

interface RadarProps {
  state: GameState;
  interactive: boolean;
  compact: boolean;
  onMove: (x: number, y: number) => void;
}

export function Radar({ state, interactive, compact, onMove }: RadarProps) {
  const { blocks, streets } = PLAN;
  const me = you(state);
  const reveal = isRevealed(state);

  const pulseAge = state.fx - state.pulseFxAt;
  const pulseT = Math.min(1, pulseAge / 1300);
  const showPulse = pulseT < 1;

  const handle = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onMove(
      ((e.clientX - rect.left) / rect.width) * WORLD,
      ((e.clientY - rect.top) / rect.height) * WORLD,
    );
  };

  return (
    <svg
      viewBox={`0 0 ${WORLD} ${WORLD}`}
      className={`h-full w-full ${interactive ? "cursor-crosshair" : "cursor-default"}`}
      onClick={handle}
      role="img"
      aria-label="Radar plan of the play area"
    >
      <defs>
        <mask id="zone-outside">
          <rect width={WORLD} height={WORLD} fill="white" />
          <circle
            cx={ZONE_CENTER.x}
            cy={ZONE_CENTER.y}
            r={state.zone.r}
            fill="black"
          />
        </mask>
      </defs>

      <rect width={WORLD} height={WORLD} fill="var(--color-paper)" />

      {/* city blocks */}
      <g fill="var(--color-ink)" opacity={0.05}>
        {blocks.map((b, i) => (
          <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} />
        ))}
      </g>

      {/* streets */}
      <g
        stroke="var(--color-ink)"
        strokeOpacity={0.16}
        strokeWidth={1.4}
        strokeLinecap="round"
      >
        {streets.map((s, i) => (
          <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
        ))}
        <line
          x1={-10}
          y1={690}
          x2={WORLD + 10}
          y2={150}
          strokeOpacity={0.22}
          strokeWidth={3}
        />
      </g>

      {/* out-of-bounds wash */}
      <rect
        width={WORLD}
        height={WORLD}
        fill="var(--color-clay)"
        opacity={0.09}
        mask="url(#zone-outside)"
      />
      <circle
        cx={ZONE_CENTER.x}
        cy={ZONE_CENTER.y}
        r={state.zone.r}
        fill="none"
        stroke="var(--color-clay)"
        strokeOpacity={0.75}
        strokeWidth={2}
        strokeDasharray="12 9"
      />
      {!compact && (
        <text
          x={ZONE_CENTER.x}
          y={ZONE_CENTER.y - state.zone.r}
          textAnchor="middle"
          dy={-10}
          className="font-mono"
          fontSize={15}
          letterSpacing="0.22em"
          fill="var(--color-clay)"
          opacity={0.9}
        >
          PLAYABLE AREA · {Math.round(state.zone.r * 2)} M
        </text>
      )}

      {/* radar pulse */}
      {showPulse && (
        <g fill="none" stroke="var(--color-ochre)" pointerEvents="none">
          {[0, 0.22, 0.44].map((offset) => {
            const t = Math.min(1, Math.max(0, pulseT - offset));
            return (
              <circle
                key={offset}
                cx={ZONE_CENTER.x}
                cy={ZONE_CENTER.y}
                r={40 + t * (WORLD * 0.75)}
                strokeOpacity={(1 - t) * 0.55}
                strokeWidth={2.5}
              />
            );
          })}
        </g>
      )}

      {/* last known shadow positions */}
      {state.agents.map((a) => {
        if (a.team !== "shadow") return null;

        if (!a.alive) {
          return (
            <g
              key={a.id}
              stroke="var(--color-ink)"
              strokeOpacity={0.35}
              strokeWidth={2}
            >
              <line x1={a.x - 9} y1={a.y - 9} x2={a.x + 9} y2={a.y + 9} />
              <line x1={a.x - 9} y1={a.y + 9} x2={a.x + 9} y2={a.y - 9} />
            </g>
          );
        }

        if (isLive(state, a)) {
          const op = reveal ? 1 : 0.95;
          return (
            <g key={a.id}>
              <circle
                cx={a.x}
                cy={a.y}
                r={20}
                fill="var(--color-clay)"
                opacity={reveal ? 0.14 : 0.1}
              />
              <circle
                cx={a.x}
                cy={a.y}
                r={7.5}
                fill="var(--color-clay)"
                opacity={op}
              />
              <circle
                cx={a.x}
                cy={a.y}
                r={15}
                fill="none"
                stroke="var(--color-clay)"
                strokeOpacity={0.7}
                strokeWidth={1.5}
              />
              {!compact && (
                <text
                  x={a.x + 22}
                  y={a.y + 5}
                  className="font-mono"
                  fontSize={15}
                  letterSpacing="0.14em"
                  fill="var(--color-clay)"
                >
                  {a.name.toUpperCase()}
                </text>
              )}
            </g>
          );
        }

        const ghost = state.ghosts[a.id];
        if (!ghost) return null;
        const age = Math.min(1, (state.elapsed - ghost.at) / (3 * 60_000));
        const op = 0.85 - age * 0.5;
        return (
          <g key={a.id} opacity={op}>
            <circle cx={ghost.x} cy={ghost.y} r={6} fill="var(--color-clay)" />
            <circle
              cx={ghost.x}
              cy={ghost.y}
              r={13}
              fill="none"
              stroke="var(--color-clay)"
              strokeWidth={1.5}
            />
            <line
              x1={ghost.x - 20}
              y1={ghost.y}
              x2={ghost.x - 15}
              y2={ghost.y}
              stroke="var(--color-clay)"
              strokeWidth={1.5}
            />
            <line
              x1={ghost.x + 15}
              y1={ghost.y}
              x2={ghost.x + 20}
              y2={ghost.y}
              stroke="var(--color-clay)"
              strokeWidth={1.5}
            />
            {!compact && (
              <text
                x={ghost.x + 24}
                y={ghost.y + 5}
                className="font-mono"
                fontSize={14}
                letterSpacing="0.14em"
                fill="var(--color-clay)"
                opacity={0.85}
              >
                {a.name.toUpperCase()}
              </text>
            )}
          </g>
        );
      })}

      {/* your team */}
      {state.agents
        .filter((a) => a.team === "hunter")
        .map((a) => (
          <g key={a.id}>
            {a.you && (
              <>
                <circle
                  cx={a.x}
                  cy={a.y}
                  r={26}
                  fill="var(--color-ochre)"
                  opacity={0.16}
                />
                <circle
                  cx={me.tx}
                  cy={me.ty}
                  r={9}
                  fill="none"
                  stroke="var(--color-ink)"
                  strokeOpacity={0.35}
                  strokeWidth={1.2}
                  strokeDasharray="4 5"
                />
              </>
            )}
            <circle
              cx={a.x}
              cy={a.y}
              r={a.you ? 12 : 9}
              fill="var(--color-paper)"
              stroke="var(--color-ink)"
              strokeWidth={a.you ? 2.4 : 1.8}
            />
            <circle cx={a.x} cy={a.y} r={3} fill="var(--color-ink)" />
            {!compact && (
              <text
                x={a.x + (a.you ? 20 : 17)}
                y={a.y + 5}
                className="font-mono"
                fontSize={14}
                letterSpacing="0.14em"
                fill="var(--color-ink)"
                opacity={a.you ? 0.95 : 0.6}
              >
                {a.you ? "YOU" : a.name.toUpperCase()}
              </text>
            )}
          </g>
        ))}

      {/* drawing furniture: north arrow + scale bar */}
      {!compact && (
        <g
          stroke="var(--color-ink)"
          strokeOpacity={0.45}
          fill="var(--color-ink)"
          fillOpacity={0.5}
        >
          <line
            x1={WORLD - 44}
            y1={64}
            x2={WORLD - 44}
            y2={30}
            strokeWidth={1.4}
          />
          <path
            d={`M ${WORLD - 44} 22 l 6 12 l -6 -4 l -6 4 z`}
            stroke="none"
          />
          <text
            x={WORLD - 44}
            y={82}
            textAnchor="middle"
            className="font-mono"
            fontSize={13}
            letterSpacing="0.1em"
            stroke="none"
          >
            N
          </text>
          <line
            x1={34}
            y1={WORLD - 34}
            x2={134}
            y2={WORLD - 34}
            strokeWidth={1.6}
          />
          <line
            x1={34}
            y1={WORLD - 40}
            x2={34}
            y2={WORLD - 28}
            strokeWidth={1.6}
          />
          <line
            x1={134}
            y1={WORLD - 40}
            x2={134}
            y2={WORLD - 28}
            strokeWidth={1.6}
          />
          <text
            x={34}
            y={WORLD - 44}
            className="font-mono"
            fontSize={13}
            letterSpacing="0.12em"
            stroke="none"
          >
            100 M
          </text>
        </g>
      )}
    </svg>
  );
}
