/**
 * Shadow Hunt — match simulation.
 *
 * Everything here is pure TypeScript (no React, no aliases) so the whole match
 * can also be stepped headless for balance checks.
 *
 * Rules are expressed in *game* time: the radar pings every 3 game minutes, the
 * zone contracts every 10 game minutes, the match runs 30 game minutes. The UI
 * advances that clock at TIME_SCALE so a demo match lasts a couple of minutes of
 * real time.
 */

/* ---------- world & rules ---------- */

export const WORLD = 800;
export const ZONE_CENTER = { x: WORLD / 2, y: WORLD / 2 };
/** Zone radius at kickoff, after the 10-minute contraction, after the 20-minute one. */
export const ZONE_RADII = [370, 258, 186];

export const TIME_SCALE = 15;
export const TICK_MS = 100;
export const MATCH_MS = 30 * 60_000;
export const PING_MS = 3 * 60_000;
export const ZONE_MS = 10 * 60_000;
/** How long a ping keeps every shadow live on the radar before they drop to ghosts. */
export const REVEAL_MS = 45_000;
export const ZONE_ANIM_MS = 1600; // real ms

/* ---------- movement & contact ---------- */

export const HUNTER_SPEED = 3.8; // world units per game-second
export const SHADOW_SPEED = 3.2;
/** Shadows creep while unobserved and sprint once a hunter is close. */
export const SHADOW_SNEAK = 0.45;
export const YOU_SPEED = 4.2;
export const TAG_RANGE = 26;
export const DETECT_RANGE = 61;
export const FLEE_RANGE = 115;
/**
 * How far a bot will cut across a ping to chase a live signal. Bots only read
 * stale ghosts beyond this — the human reading the radar is the one who closes
 * the gap, which is what makes playing worth it.
 */
export const REVEAL_CHASE_RANGE = 120;
export const AI_DECIDE_MS = 800;

export const HUNTERS = 3; // including the human player
export const SHADOWS = 3;

/* ---------- types ---------- */

export type Team = "hunter" | "shadow";

export interface Agent {
  id: string;
  name: string;
  team: Team;
  you: boolean;
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
  alive: boolean;
  taggedAt: number | null;
  taggedBy: string | null;
  decideIn: number;
  /** Per-shadow escape heading offset, so a pack scatters instead of fleeing in a line. */
  bias: number;
}

export interface Ghost {
  x: number;
  y: number;
  at: number;
}

export type LogKind = "pulse" | "zone" | "tag" | "system";

export interface LogEntry {
  id: number;
  at: number;
  kind: LogKind;
  text: string;
}

export interface Zone {
  r: number;
  fromR: number;
  toR: number;
  animStart: number;
  shrinks: number;
  nextAt: number;
}

export interface GameState {
  phase: "running" | "ended";
  elapsed: number; // game ms
  fx: number; // real ms since kickoff, drives animations
  agents: Agent[];
  zone: Zone;
  ghosts: Record<string, Ghost>;
  revealUntil: number;
  nextPingAt: number;
  pulses: number;
  pulseFxAt: number;
  taggedCount: number;
  yourTags: number;
  logs: LogEntry[];
  logId: number;
  seed: number;
  result: "hunters" | "shadows" | null;
  startedAt: number;
}

export interface RosterEntry {
  name: string;
  team: Team;
}

/* ---------- helpers ---------- */

export function distance(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

function clamp(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Deterministic-ish RNG kept inside the state so replays/balance runs are stable. */
function rnd(s: GameState): number {
  s.seed = (s.seed + 0x6d2b79f5) | 0;
  let t = s.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pick<T>(s: GameState, pool: T[]): T {
  return pool[Math.floor(rnd(s) * pool.length) % pool.length];
}

function removeFrom<T>(pool: T[], value: T) {
  const i = pool.indexOf(value);
  if (i >= 0) pool.splice(i, 1);
}

function pointInZone(s: GameState, radiusPad = 40) {
  const max = Math.max(30, s.zone.toR - radiusPad);
  const a = rnd(s) * Math.PI * 2;
  const r = Math.sqrt(rnd(s)) * max;
  return {
    x: clamp(ZONE_CENTER.x + Math.cos(a) * r, 0, WORLD),
    y: clamp(ZONE_CENTER.y + Math.sin(a) * r, 0, WORLD),
  };
}

const HUNTER_CALLSIGNS = [
  "Rook",
  "Vega",
  "Atlas",
  "Cinder",
  "Bolt",
  "Juno",
  "Marlow",
  "Pike",
];

const SHADOW_CALLSIGNS = [
  "Wisp",
  "Moth",
  "Haze",
  "Echo",
  "Veil",
  "Drift",
  "Smog",
  "Fenn",
];

export const TOTAL_PLAYERS = HUNTERS + SHADOWS;

/** The simulated room: the human is always on the Hunters. */
export function createRoster(playerName: string, seed: number): RosterEntry[] {
  const scratch: GameState = {
    seed,
    agents: [],
    logs: [],
    logId: 0,
    zone: { r: 0, fromR: 0, toR: 0, animStart: 0, shrinks: 0, nextAt: 0 },
    ghosts: {},
    elapsed: 0,
    fx: 0,
    phase: "running",
    revealUntil: 0,
    nextPingAt: 0,
    pulses: 0,
    pulseFxAt: 0,
    taggedCount: 0,
    yourTags: 0,
    result: null,
    startedAt: 0,
  };

  const hunters = HUNTER_CALLSIGNS.filter((c) => c !== playerName);
  const shadows = SHADOW_CALLSIGNS.filter((c) => c !== playerName);
  const roster: RosterEntry[] = [{ name: playerName, team: "hunter" }];

  for (let i = 1; i < HUNTERS; i++) {
    const name = pick(scratch, hunters);
    removeFrom(hunters, name);
    roster.push({ name, team: "hunter" });
  }
  for (let i = 0; i < SHADOWS; i++) {
    const name = pick(scratch, shadows);
    removeFrom(shadows, name);
    roster.push({ name, team: "shadow" });
  }
  return roster;
}

function log(s: GameState, kind: LogKind, text: string) {
  s.logs.push({ id: s.logId++, at: s.elapsed, kind, text });
  if (s.logs.length > 6) s.logs.shift();
}

function spawnPosition(s: GameState, team: Team, index: number) {
  const angle = (index / (team === "shadow" ? SHADOWS : HUNTERS)) * Math.PI * 2;
  if (team === "shadow") {
    // Shadows start out on the rim, hunters start boxed in around the middle.
    const r = 250 + rnd(s) * 110;
    return {
      x: clamp(ZONE_CENTER.x + Math.cos(angle) * r, 0, WORLD),
      y: clamp(ZONE_CENTER.y + Math.sin(angle) * r, 0, WORLD),
    };
  }
  const r = rnd(s) * 60;
  return {
    x: clamp(ZONE_CENTER.x + Math.cos(angle) * r, 0, WORLD),
    y: clamp(ZONE_CENTER.y + Math.sin(angle) * r, 0, WORLD),
  };
}

export function createGame(
  playerName: string,
  roster: RosterEntry[],
  seed: number,
): GameState {
  const s: GameState = {
    phase: "running",
    elapsed: 0,
    fx: 0,
    agents: [],
    zone: {
      r: ZONE_RADII[0],
      fromR: ZONE_RADII[0],
      toR: ZONE_RADII[0],
      animStart: -ZONE_ANIM_MS,
      shrinks: 0,
      nextAt: ZONE_MS,
    },
    ghosts: {},
    revealUntil: REVEAL_MS,
    nextPingAt: PING_MS,
    pulses: 1,
    pulseFxAt: 0,
    taggedCount: 0,
    yourTags: 0,
    logs: [],
    logId: 0,
    seed,
    result: null,
    startedAt: 0,
  };

  let huntersPlaced = 0;
  let shadowsPlaced = 0;
  for (const entry of roster) {
    const index = entry.team === "hunter" ? huntersPlaced++ : shadowsPlaced++;
    const spawn = spawnPosition(s, entry.team, index);
    const speed =
      entry.team === "hunter"
        ? entry.name === playerName
          ? YOU_SPEED
          : HUNTER_SPEED
        : SHADOW_SPEED;
    s.agents.push({
      id: `${entry.team}-${index}-${entry.name.toLowerCase()}`,
      name: entry.name,
      team: entry.team,
      you: entry.team === "hunter" && entry.name === playerName,
      x: spawn.x,
      y: spawn.y,
      tx: spawn.x,
      ty: spawn.y,
      speed,
      alive: true,
      taggedAt: null,
      taggedBy: null,
      decideIn: rnd(s) * AI_DECIDE_MS,
      bias: (rnd(s) * 2 - 1) * 0.75,
    });
  }

  // Kickoff ping: everyone is visible on the first sweep, then it goes stale.
  for (const a of s.agents) {
    if (a.team === "shadow") s.ghosts[a.id] = { x: a.x, y: a.y, at: 0 };
  }
  log(s, "system", "Kickoff — shadows on the rim, hunters at the centre");
  log(s, "pulse", `Radar pulse — ${SHADOWS} signals`);
  return s;
}

/* ---------- selectors ---------- */

export const you = (s: GameState) => s.agents.find((a) => a.you)!;

export const aliveShadows = (s: GameState) =>
  s.agents.filter((a) => a.team === "shadow" && a.alive);

export function isRevealed(s: GameState) {
  return s.elapsed < s.revealUntil;
}

/** A shadow is live on your radar during a ping, or whenever you are close enough to see it. */
export function isLive(s: GameState, agent: Agent) {
  if (agent.team !== "shadow" || !agent.alive) return false;
  if (isRevealed(s)) return true;
  const me = you(s);
  return distance(me.x, me.y, agent.x, agent.y) <= DETECT_RANGE;
}

/** Nearest shadow you could tag right now, or null. */
export function taggable(s: GameState): { agent: Agent; dist: number } | null {
  const me = you(s);
  let best: Agent | null = null;
  let bestDist = Infinity;
  for (const a of s.agents) {
    if (a.team !== "shadow" || !a.alive) continue;
    const d = distance(me.x, me.y, a.x, a.y);
    if (d < bestDist) {
      best = a;
      bestDist = d;
    }
  }
  if (!best || bestDist > TAG_RANGE) return null;
  return { agent: best, dist: bestDist };
}

export function setDestination(s: GameState, x: number, y: number): GameState {
  const next: GameState = { ...s, agents: s.agents.map((a) => ({ ...a })) };
  const me = you(next);
  me.tx = clamp(x, 0, WORLD);
  me.ty = clamp(y, 0, WORLD);
  return next;
}

export function tryTag(s: GameState): GameState {
  const target = taggable(s);
  if (!target) return s;
  return applyTag(s, target.agent, you(s));
}

function applyTag(s: GameState, shadow: Agent, hunter: Agent): GameState {
  shadow.alive = false;
  shadow.taggedAt = s.elapsed;
  shadow.taggedBy = hunter.name;
  shadow.tx = shadow.x;
  shadow.ty = shadow.y;
  s.taggedCount += 1;
  if (hunter.you) s.yourTags += 1;
  log(s, "tag", `${hunter.name} tagged ${shadow.name}`);
  if (aliveShadows(s).length === 0) {
    s.phase = "ended";
    s.result = "hunters";
    log(s, "system", "All shadows tagged — Hunters win");
  }
  return s;
}

/* ---------- AI ---------- */

function nearestHunter(s: GameState, a: Agent) {
  let best: Agent | null = null;
  let bestDist = Infinity;
  for (const h of s.agents) {
    if (h.team !== "hunter") continue;
    const d = distance(a.x, a.y, h.x, h.y);
    if (d < bestDist) {
      best = h;
      bestDist = d;
    }
  }
  return { hunter: best, dist: bestDist };
}

/**
 * Escape heading: run away from the nearest hunter, but on the shadow's own
 * bearing so a pack splits up. If that line leaves the circle, slide along the
 * rim in whichever direction increases the gap instead of stopping dead.
 */
function escape(s: GameState, a: Agent, hunter: Agent) {
  const away = Math.atan2(a.y - hunter.y, a.x - hunter.x) + a.bias;
  const want = { x: a.x + Math.cos(away) * 300, y: a.y + Math.sin(away) * 300 };
  const max = Math.max(30, s.zone.r - 32);
  const wx = want.x - ZONE_CENTER.x;
  const wy = want.y - ZONE_CENTER.y;
  if (Math.hypot(wx, wy) <= max) return want;

  const ang = Math.atan2(a.y - ZONE_CENTER.y, a.x - ZONE_CENTER.x);
  const r = Math.min(Math.hypot(wx, wy), max);
  const options = [ang + 0.3, ang - 0.3].map((t) => ({
    x: ZONE_CENTER.x + Math.cos(t) * r,
    y: ZONE_CENTER.y + Math.sin(t) * r,
  }));
  return distance(options[0].x, options[0].y, hunter.x, hunter.y) >=
    distance(options[1].x, options[1].y, hunter.x, hunter.y)
    ? options[0]
    : options[1];
}

function decideShadow(s: GameState, a: Agent) {
  const { hunter, dist } = nearestHunter(s, a);

  // A ping does not spook a shadow on its own — only proximity does.
  if (hunter && dist < FLEE_RANGE) {
    a.speed = SHADOW_SPEED;
    const flee = escape(s, a, hunter);
    a.tx = flee.x;
    a.ty = flee.y;
    return;
  }

  // Unobserved: creep, so the position you ping from stays close to the truth.
  a.speed = SHADOW_SPEED * SHADOW_SNEAK;
  if (distance(a.x, a.y, a.tx, a.ty) < 30 || rnd(s) < 0.2) {
    let choice = pointInZone(s);
    for (let tries = 0; tries < 6; tries++) {
      const candidate = pointInZone(s);
      choice = candidate;
      const crowded = s.agents.some(
        (other) =>
          other !== a &&
          other.team === "shadow" &&
          other.alive &&
          distance(candidate.x, candidate.y, other.x, other.y) < 90,
      );
      const nearHunter = s.agents.some(
        (other) =>
          other.team === "hunter" &&
          distance(candidate.x, candidate.y, other.x, other.y) < FLEE_RANGE,
      );
      if (!crowded && !nearHunter) break;
    }
    a.tx = choice.x;
    a.ty = choice.y;
  }
}

function decideHunter(s: GameState, a: Agent) {
  const alive = aliveShadows(s);
  if (!alive.length) return;

  // Split the search: each hunter works a different shadow so the pack covers
  // the circle instead of stacking on one ghost.
  const ordered = alive.slice().sort((x, y) => (x.id < y.id ? -1 : 1));
  const hunters = s.agents.filter((h) => h.team === "hunter");
  const slot = Math.max(0, hunters.findIndex((h) => h.id === a.id));
  const assigned = ordered[slot % ordered.length];

  // Close contact beats assignment — take the shadow you can actually see.
  let visible: Agent | null = null;
  let visibleDist = Infinity;
  for (const sh of alive) {
    const d = distance(a.x, a.y, sh.x, sh.y);
    if (d <= DETECT_RANGE && d < visibleDist) {
      visible = sh;
      visibleDist = d;
    }
  }
  if (visible) {
    a.tx = visible.x;
    a.ty = visible.y;
    return;
  }

  // During a ping everyone is on the same radar — bots commit to their signal
  // only when it is close enough to be worth the sprint.
  if (isRevealed(s)) {
    const d = distance(a.x, a.y, assigned.x, assigned.y);
    if (d <= REVEAL_CHASE_RANGE) {
      a.tx = assigned.x;
      a.ty = assigned.y;
      return;
    }
  }

  const ghost = s.ghosts[assigned.id];
  if (ghost && distance(a.x, a.y, ghost.x, ghost.y) > 40) {
    a.tx = ghost.x;
    a.ty = ghost.y;
    return;
  }

  if (distance(a.x, a.y, a.tx, a.ty) < 40 || rnd(s) < 0.25) {
    const sweep = pointInZone(s, 30);
    a.tx = sweep.x;
    a.ty = sweep.y;
  }
}

/* ---------- step ---------- */

export function stepGame(
  input: GameState,
  dtGame: number,
  dtReal: number,
): GameState {
  if (input.phase === "ended") return input;

  const s: GameState = {
    ...input,
    agents: input.agents.map((a) => ({ ...a })),
    zone: { ...input.zone },
    ghosts: { ...input.ghosts },
    logs: input.logs.slice(),
  };

  s.fx += dtReal;
  s.elapsed += dtGame;

  /* zone contraction */
  if (s.elapsed >= s.zone.nextAt && s.zone.shrinks < ZONE_RADII.length - 1) {
    s.zone.shrinks += 1;
    s.zone.fromR = s.zone.r;
    s.zone.toR = ZONE_RADII[s.zone.shrinks];
    s.zone.animStart = s.fx;
    s.zone.nextAt += ZONE_MS;
    log(s, "zone", `Zone contracting — ${Math.round(s.zone.toR * 2)} m across`);
  }
  const animT = clamp((s.fx - s.zone.animStart) / ZONE_ANIM_MS, 0, 1);
  s.zone.r = lerp(s.zone.fromR, s.zone.toR, easeInOut(animT));

  /* radar ping */
  if (s.elapsed >= s.nextPingAt) {
    s.pulses += 1;
    s.nextPingAt += PING_MS;
    s.revealUntil = s.elapsed + REVEAL_MS;
    s.pulseFxAt = s.fx;
    const alive = aliveShadows(s);
    for (const a of alive) s.ghosts[a.id] = { x: a.x, y: a.y, at: s.elapsed };
    log(s, "pulse", `Radar pulse — ${alive.length} signal${alive.length === 1 ? "" : "s"}`);
  }

  /* movement + AI */
  for (const a of s.agents) {
    if (!a.alive) continue;

    a.decideIn -= dtGame;
    if (!a.you && a.decideIn <= 0) {
      a.decideIn = AI_DECIDE_MS;
      if (a.team === "shadow") decideShadow(s, a);
      else decideHunter(s, a);
    }

    const dx = a.tx - a.x;
    const dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.5) {
      const step = (a.speed * dtGame) / 1000;
      if (step >= d) {
        a.x = a.tx;
        a.y = a.ty;
      } else {
        a.x += (dx / d) * step;
        a.y += (dy / d) * step;
      }
    }
    a.x = clamp(a.x, 0, WORLD);
    a.y = clamp(a.y, 0, WORLD);
  }

  /* bots tag on contact — the human presses TAG themselves */
  for (const h of s.agents) {
    if (h.team !== "hunter" || h.you) continue;
    for (const sh of s.agents) {
      if (sh.team !== "shadow" || !sh.alive) continue;
      if (distance(h.x, h.y, sh.x, sh.y) <= TAG_RANGE) {
        applyTag(s, sh, h);
        if (s.phase === "ended") return s;
        break;
      }
    }
  }

  /* time out */
  if (s.elapsed >= MATCH_MS) {
    s.elapsed = MATCH_MS;
    s.phase = "ended";
    s.result = "shadows";
    log(s, "system", "Time — Shadows survive");
  }

  return s;
}

/* ---------- display helpers ---------- */

export function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function msToGameMinutes(ms: number) {
  return Math.max(0, Math.round(ms / 60000));
}
