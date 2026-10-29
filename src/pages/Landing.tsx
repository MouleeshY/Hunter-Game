import { motion } from "framer-motion";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

const rise = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
};

const SPEC = [
  "Radar pulse every 3 minutes",
  "Playable area contracts every 10",
  "30-minute matches",
  "No referee required",
];

const STEPS = [
  {
    n: "01",
    title: "The pulse",
    body: "Every three minutes the radar fires and every player's position lands on the map at once. Shadows get three minutes of anonymity, then a dot — somewhere in the city, marked in clay.",
  },
  {
    n: "02",
    title: "The squeeze",
    body: "Ten minutes in, the playable area contracts. Ten minutes later it contracts again. Streets, lots and alleys fall outside the line, and the hiding places go with them.",
  },
  {
    n: "03",
    title: "The tag",
    body: "Hunters win by getting a hand on every shadow before the clock hits zero. Shadows win by never letting that happen. Either way, everyone is running.",
  },
];

const TEAMS = [
  {
    name: "Hunters",
    count: "3 players",
    line: "You move first and think later.",
    points: [
      "Start bunched at the centre of the plan",
      "See your own team live at all times",
      "A tag counts at arm's length",
    ],
  },
  {
    name: "Shadows",
    count: "3 players",
    line: "You are the one being looked for.",
    points: [
      "Start out on the rim with a head start",
      "Creep while nobody is looking, sprint when they are",
      "Survive thirty minutes and you win",
    ],
  },
];

const STATS = [
  { value: "6", label: "Total players" },
  { value: "3", label: "Shadows tagged" },
  { value: "0", label: "Shadows survived" },
  { value: "9", label: "Radar pulses fired" },
];

/** Static plan drawing for the hero — the radar, rendered as a gallery plate. */
function HeroPlan() {
  const grid = [42, 96, 158, 226, 292, 354];
  return (
    <svg viewBox="0 0 400 400" className="h-full w-full" role="img" aria-label="Radar plan showing hunters closing on two shadows">
      <rect width="400" height="400" fill="var(--color-paper)" />

      <g stroke="var(--color-ink)" strokeOpacity="0.14" strokeWidth="1">
        {grid.map((v) => (
          <line key={`v${v}`} x1={v} y1="0" x2={v} y2="400" />
        ))}
        {grid.map((v) => (
          <line key={`h${v}`} x1="0" y1={v} x2="400" y2={v} />
        ))}
        <line x1="0" y1="330" x2="400" y2="70" strokeOpacity="0.2" strokeWidth="2" />
      </g>

      <g fill="var(--color-ink)" opacity="0.05">
        <rect x="50" y="50" width="40" height="40" />
        <rect x="106" y="50" width="44" height="40" />
        <rect x="166" y="106" width="54" height="44" />
        <rect x="234" y="50" width="52" height="40" />
        <rect x="50" y="166" width="40" height="54" />
        <rect x="106" y="234" width="44" height="52" />
        <rect x="300" y="166" width="46" height="54" />
        <rect x="234" y="300" width="52" height="44" />
        <rect x="300" y="300" width="46" height="44" />
      </g>

      {/* pulse rings */}
      <g fill="none" stroke="var(--color-ochre)">
        <circle cx="200" cy="200" r="74" strokeOpacity="0.55" strokeWidth="1.5" />
        <circle cx="200" cy="200" r="122" strokeOpacity="0.35" strokeWidth="1.5" />
        <circle cx="200" cy="200" r="170" strokeOpacity="0.18" strokeWidth="1.5" />
      </g>

      {/* playable area */}
      <circle
        cx="200"
        cy="200"
        r="150"
        fill="none"
        stroke="var(--color-clay)"
        strokeOpacity="0.8"
        strokeWidth="1.6"
        strokeDasharray="9 7"
      />
      <text
        x="200"
        y="50"
        textAnchor="middle"
        className="font-mono"
        fontSize="9"
        letterSpacing="2.4"
        fill="var(--color-clay)"
      >
        PLAYABLE AREA
      </text>

      {/* shadows */}
      <g>
        <circle cx="118" cy="252" r="17" fill="var(--color-clay)" opacity="0.14" />
        <circle cx="118" cy="252" r="12" fill="none" stroke="var(--color-clay)" strokeWidth="1.3" />
        <circle cx="118" cy="252" r="5" fill="var(--color-clay)" />
        <text x="136" y="256" className="font-mono" fontSize="9.5" letterSpacing="1.6" fill="var(--color-clay)">
          WISP
        </text>

        <circle cx="286" cy="132" r="17" fill="var(--color-clay)" opacity="0.14" />
        <circle cx="286" cy="132" r="12" fill="none" stroke="var(--color-clay)" strokeWidth="1.3" />
        <circle cx="286" cy="132" r="5" fill="var(--color-clay)" />
        <text x="304" y="136" className="font-mono" fontSize="9.5" letterSpacing="1.6" fill="var(--color-clay)">
          MOTH
        </text>
      </g>

      {/* hunters */}
      <g>
        <circle cx="176" cy="168" r="8" fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth="1.6" />
        <circle cx="176" cy="168" r="2.6" fill="var(--color-ink)" />

        <circle cx="200" cy="200" r="26" fill="var(--color-ochre)" opacity="0.16" />
        <circle cx="200" cy="200" r="11" fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth="2.2" />
        <circle cx="200" cy="200" r="3.4" fill="var(--color-ink)" />
        <text x="218" y="204" className="font-mono" fontSize="9.5" letterSpacing="1.6" fill="var(--color-ink)">
          YOU
        </text>
      </g>

      {/* north + scale */}
      <g stroke="var(--color-ink)" strokeOpacity="0.45" fill="var(--color-ink)" fillOpacity="0.55">
        <line x1="366" y1="46" x2="366" y2="20" strokeWidth="1.2" />
        <path d="M 366 14 l 5 10 l -5 -3.4 l -5 3.4 z" stroke="none" />
        <line x1="24" y1="376" x2="94" y2="376" strokeWidth="1.4" />
        <line x1="24" y1="371" x2="24" y2="381" strokeWidth="1.4" />
        <line x1="94" y1="371" x2="94" y2="381" strokeWidth="1.4" />
        <text x="24" y="366" className="font-mono" fontSize="9" letterSpacing="1.6" stroke="none">
          100 M
        </text>
      </g>
    </svg>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-hairline bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-clay" />
            <span className="font-display text-[15px] tracking-tight">Shadow Hunt</span>
          </Link>
          <nav className="flex items-center gap-6">
            <a
              href="#how"
              className="hidden text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              How it works
            </a>
            <a
              href="#teams"
              className="hidden text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Teams
            </a>
            <Link
              to="/play"
              className="text-[11px] uppercase tracking-[0.18em] text-foreground transition-opacity hover:opacity-70"
            >
              Play →
            </Link>
          </nav>
        </div>
      </header>

      {/* hero */}
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-14 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-14">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
            Night-time urban manhunt · played on foot
          </p>
          <h1 className="mt-5 font-display text-[clamp(2.75rem,7vw,4.75rem)] leading-[0.98] tracking-tight">
            The city goes dark.
            <br />
            <span className="italic text-clay">The map closes in.</span>
          </h1>
          <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
            Shadow Hunt is real-life tag with GPS. Six friends, two teams, and a
            radar that gives everyone away every three minutes — so hiding is only
            ever a temporary plan. The app keeps the rules, the clock and the
            score. You just run.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-11 uppercase tracking-[0.18em]">
              <Link to="/play">Create a match</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 uppercase tracking-[0.18em]">
              <Link to="/play?intent=join">Join a match</Link>
            </Button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="border border-hairline bg-card p-3 shadow-[0_1px_0_0_rgba(0,0,0,0.03)]"
        >
          <div className="aspect-square w-full">
            <HeroPlan />
          </div>
          <div className="flex items-center justify-between border-t border-hairline px-1 pt-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Plate 01 — first pulse
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              3 contacts
            </span>
          </div>
        </motion.div>
      </section>

      {/* spec strip */}
      <section className="border-y border-hairline bg-card/60">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-8 gap-y-2 px-4 py-4 sm:px-6">
          {SPEC.map((item) => (
            <span
              key={item}
              className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground"
            >
              {item}
            </span>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <motion.p
          {...rise}
          className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground"
        >
          How it works
        </motion.p>
        <div className="mt-8">
          {STEPS.map((step) => (
            <motion.article
              key={step.n}
              {...rise}
              className="grid gap-4 border-t border-hairline py-8 sm:grid-cols-[6rem_1fr] sm:gap-8 lg:grid-cols-[6rem_18rem_1fr]"
            >
              <span className="font-mono text-[13px] text-muted-foreground">{step.n}</span>
              <h3 className="font-display text-3xl leading-tight tracking-tight">
                {step.title}
              </h3>
              <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </motion.article>
          ))}
          <div className="border-t border-hairline" />
        </div>
      </section>

      {/* teams */}
      <section id="teams" className="border-y border-hairline bg-card/60">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <motion.p
            {...rise}
            className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground"
          >
            Two teams
          </motion.p>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {TEAMS.map((team, i) => (
              <motion.div
                key={team.name}
                {...rise}
                transition={{ ...rise.transition, delay: i * 0.08 }}
                className="border border-hairline bg-background p-6 sm:p-8"
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display text-3xl tracking-tight">{team.name}</h3>
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {team.count}
                  </span>
                </div>
                <p className="mt-3 text-[15px] italic text-ink/80">{team.line}</p>
                <ul className="mt-6 space-y-3 border-t border-hairline pt-5">
                  {team.points.map((point) => (
                    <li key={point} className="flex gap-3 text-[14px] text-muted-foreground">
                      <span
                        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                          team.name === "Hunters" ? "bg-ink" : "bg-clay"
                        }`}
                      />
                      {point}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* match stats */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <motion.div {...rise} className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
              At the final whistle
            </p>
            <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight sm:text-5xl">
              Every match ends with the numbers.
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              The app calls it, counts it and hands you the sheet: how many players
              were out, who got caught, who made it to zero, and how many pulses it
              took to find them.
            </p>
          </div>
          <div className="grid grid-cols-2 border-l border-t border-hairline sm:grid-cols-4">
            {STATS.map((stat) => (
              <div key={stat.label} className="border-b border-r border-hairline px-4 py-7">
                <p className="font-display text-4xl leading-none tabular-nums">
                  {stat.value}
                </p>
                <p className="mt-3 text-[11px] uppercase leading-tight tracking-[0.14em] text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* closing band */}
      <section className="bg-ink text-paper">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <motion.p {...rise} className="text-[11px] uppercase tracking-[0.28em] text-paper/60">
            11:40 pm · final tag
          </motion.p>
          <motion.h2
            {...rise}
            className="mt-4 max-w-3xl font-display text-[clamp(2.25rem,6vw,4rem)] leading-[1.02] tracking-tight"
          >
            Hunters win. <span className="italic text-ochre">Everyone loses their mind.</span>
          </motion.h2>
          <motion.div {...rise} className="mt-9 flex flex-wrap gap-3">
            <Button
              asChild
              size="lg"
              className="h-11 bg-paper text-ink uppercase tracking-[0.18em] hover:bg-paper/90"
            >
              <Link to="/demo">Play the demo</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-11 border-paper/30 bg-transparent text-paper uppercase tracking-[0.18em] hover:bg-paper/10 hover:text-paper"
            >
              <Link to="/play?intent=join">Join with a code</Link>
            </Button>
          </motion.div>
        </div>
      </section>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Shadow Hunt · v1 demo · players and rooms simulated
          </span>
          <Link
            to="/auth"
            className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
