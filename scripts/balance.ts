import {
  createGame,
  createRoster,
  stepGame,
  MATCH_MS,
  TICK_MS,
  TIME_SCALE,
  aliveShadows,
  type GameState,
} from "../src/lib/game";

const RUNS = 40;
const dtGame = TICK_MS * TIME_SCALE;

let huntersWin = 0;
let firstTags: number[] = [];
let taggedTotals: number[] = [];

for (let i = 0; i < RUNS; i++) {
  const seed = 1000 + i * 7919;
  const roster = createRoster("You", seed);
  let s = createGame("You", roster, seed);
  let firstTag: number | null = null;

  while (s.phase === "running") {
    const before = s.taggedCount;
    s = stepGame(s, dtGame, TICK_MS);
    if (s.taggedCount > before && firstTag === null) firstTag = s.elapsed;
    if (s.elapsed > MATCH_MS * 2) break;
  }

  if (s.result === "hunters") huntersWin++;
  taggedTotals.push(s.taggedCount);
  if (firstTag !== null) firstTags.push(firstTag);

  if (i < 6) {
    const timeline = s.logs
      .map(
        (l) =>
          `${(l.at / 60000).toFixed(1)}m ${l.kind}: ${l.text}`,
      )
      .join(" | ");
    console.log(
      `\nrun ${i} → ${s.result} · tagged ${s.taggedCount}/${3} · pulses ${s.pulses} · zone shrinks ${s.zone.shrinks}`,
    );
    console.log(`  ${timeline}`);
  }
}

const avg = (xs: number[]) =>
  xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "n/a";

console.log(`\n--- ${RUNS} runs ---`);
console.log(`hunters win: ${huntersWin}/${RUNS}`);
console.log(`avg tagged: ${avg(taggedTotals.map(Number))} / 3`);
console.log(
  `avg first tag: ${firstTags.length ? avg(firstTags.map((t) => t / 60000)) : "never"} min (of 30)`,
);
console.log(`matches with no tag at all: ${taggedTotals.filter((t) => t === 0).length}`);
