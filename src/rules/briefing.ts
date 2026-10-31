/**
 * The rules briefing every player must read before the head start.
 *
 * This is the ONE editable file for that copy: change the wording here and it
 * changes on every screen that shows it (player briefing, organiser preview,
 * force-start confirmation). It is plain data — no Convex, React or database
 * imports — so the rules package stays portable.
 */

export interface BriefingSection {
  heading: string;
  lines: string[];
}

export interface Briefing {
  title: string;
  intro: string;
  sections: BriefingSection[];
  /** The safety line, kept separate because it is never optional. */
  safety: string;
  /** Label of the button that records the confirmation. */
  acknowledgeLabel: string;
  /** What the organiser is told while people are still confirming. */
  pendingLabel: (pending: number, total: number) => string;
}

export const BRIEFING: Briefing = {
  title: "How Shadow Hunt is played",
  intro:
    "Read this before the head start. You will be asked to confirm that you understand it — the organiser cannot start the match until everyone has.",
  sections: [
    {
      heading: "Two teams",
      lines: [
        "Teams are drawn at random when the match starts and never change after that.",
        "Hunters tag Shadows by scanning their QR code. Shadows survive by staying out of reach until the timer runs out.",
        "If every Shadow is caught, the Hunters win. If the timer runs out with a Shadow still free, the Shadows win.",
      ],
    },
    {
      heading: "The head start",
      lines: [
        "Shadows get a head start before Hunters can see anything. Nobody's location is uploaded or revealed during it.",
        "The match goes live the moment the head start ends, and points start counting from then.",
      ],
    },
    {
      heading: "The play area",
      lines: [
        "Everyone plays inside one zone. It shrinks on a fixed schedule, and the radius is shown on your screen.",
        "Stay inside: past a short grace period your points drain, and after about three minutes outside you are out of the match.",
      ],
    },
    {
      heading: "Tagging",
      lines: [
        "A tag only counts when both phones are roughly 40 m apart and both positions are current — within the last 30 seconds.",
        "Open your code only when you are really caught. A refused scan costs the Hunter nothing and can be reported.",
        "Once you are caught you choose what happens next: Spectator, join the Hunters, or Helper.",
      ],
    },
    {
      heading: "Complaints",
      lines: [
        "If a Shadow will not show their code, report it from the match screen and name who it was.",
        "An invigilator has a short, fixed window to answer, and every decision they make is logged.",
      ],
    },
    {
      heading: "What the pings show",
      lines: [
        "Hunters do not see Shadows live. Every few minutes a ping reveals where each free Shadow last was — a ghost that fades.",
        "Spectators and Helpers see exactly the same thing a Hunter sees.",
        "Invigilators see everything live so they can settle disputes.",
      ],
    },
  ],
  safety:
    "Stay off roads and private property. Play in daylight, keep aware of your surroundings, and look after the people around you — a game is never worth an injury. If something goes wrong, use the “I need help” button.",
  acknowledgeLabel: "I understand",
  pendingLabel: (pending, total) =>
    `${pending} of ${total} players have not confirmed the rules yet.`,
};
