import { useState, useCallback } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { UseFormReturn, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { RULES_CONFIG } from "@/convex/rules/config";

const createMatchSchema = z.object({
  duration: z
    .number()
    .int()
    .min(RULES_CONFIG.eventWindowMinutes.min)
    .max(RULES_CONFIG.eventWindowMinutes.max),
  invigilators: z
    .number()
    .int()
    .min(RULES_CONFIG.invigilatorCount.min)
    .max(RULES_CONFIG.invigilatorCount.max),
});

const joinMatchSchema = z.object({
  roomCode: z
    .string()
    .length(5, "Room code is 5 characters")
    .regex(
      /^[2-9A-Z]{5}$/,
      "Room code uses the on-screen character set",
    ),
  displayName: z
    .string()
    .min(1, "Display name is required")
    .max(60, "Display name is too long"),
  callSign: z
    .string()
    .min(1, "Call sign is required")
    .max(32, "Call sign is too long"),
});

type CreateMatchValues = z.infer<typeof createMatchSchema>;
type JoinMatchValues = z.infer<typeof joinMatchSchema>;

function DurationField(props: { children?: React.ReactNode }) {
  return <>{props.children}</>;
}

function InvigilatorsField(props: { children?: React.ReactNode }) {
  return <>{props.children}</>;
}

function RoomCodeField(props: { children?: React.ReactNode }) {
  return <>{props.children}</>;
}

function DisplayNameField(props: { children?: React.ReactNode }) {
  return <>{props.children}</>;
}

function CallSignField(props: { children?: React.ReactNode }) {
  return <>{props.children}</>;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const ref = React.useRef<HTMLInputElement | null>(null);

  function copy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(value)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        })
        .catch(() => {});
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        ref={ref}
        value={value}
        readOnly
        className="w-24 text-center font-display tracking-[0.2em] uppercase tabular-nums bg-transparent border-transparent focus:border-transparent focus:ring-0 cursor-default"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 px-3 uppercase tracking-[0.16em]"
        onClick={copy}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

import React from "react";

type View =
  | { kind: "choose" }
  | { kind: "creating"; form: UseFormReturn<CreateMatchValues> }
  | { kind: "created"; roomCode: string }
  | { kind: "joining"; form: UseFormReturn<JoinMatchValues> }
  | { kind: "joined"; roomCode: string }
  | { kind: "lobby"; roomCode: string; players: PlayerInLobby[] };

interface PlayerInLobby {
  id: string;
  displayName: string;
  role: string;
}

function LobbyView({ roomCode, players }: { roomCode: string; players: PlayerInLobby[] }) {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Lobby
          </p>
          <h1 className="mt-1 font-display text-3xl tracking-tight">
            Room {roomCode}
          </h1>
        </div>
        <CopyButton value={roomCode} />
      </div>

      <div className="border-t border-hairline pt-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Players
        </p>
        {players.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            No one has joined yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {players.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between text-[13px]"
              >
                <span className="text-foreground">{p.displayName}</span>
                <span className="text-muted-foreground">{p.role}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-hairline pt-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Organiser controls
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button size="lg" className="h-11 uppercase tracking-[0.18em]">
            Lock roster
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-11 uppercase tracking-[0.18em]"
          >
            Re-roll centre
          </Button>
        </div>
      </div>

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        The real lobby, live roster updates, the start button, team assignment,
        invigilator invite codes and the monitor page arrive in the rest of Stage
        2. This shell proves the route, the room code and the organiser panel.
      </p>

      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg" className="h-11 uppercase tracking-[0.18em]">
          <Link to="/">Back to landing</Link>
        </Button>
      </div>
    </div>
  );
}

export default function Play() {
  const [view, setView] = useState<View>({ kind: "choose" });

  const createFormRef = useCallback(
    (form: UseFormReturn<CreateMatchValues>) => {
      setView({ kind: "creating", form });
    },
    [],
  );
  const joinFormRef = useCallback(
    (form: UseFormReturn<JoinMatchValues>) => {
      setView({ kind: "joining", form });
    },
    [],
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-clay" />
            <span className="font-display text-[15px] tracking-tight">
              Shadow Hunt
            </span>
          </Link>
          <Link
            to="/"
            className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Landing
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
          Stage 2 · rooms and lobby
        </p>

        {view.kind === "choose" && (
          <>
            <h1 className="mt-4 max-w-2xl font-display text-5xl leading-[1.03] tracking-tight">
              Start a room, or{" "}
              <span className="italic text-clay">join one</span>.
            </h1>
            <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
              Organisers create a room, set the match length and attach
              invigilators. Everyone else picks their display name and call sign,
              types in a five-character room code and waits in the lobby.
            </p>

            <div className="mt-10 flex flex-wrap gap-6">
              <div className="flex-1 min-w-[220px] rounded-xl border border-hairline p-6">
                <h2 className="font-display text-xl tracking-tight">
                  Create a room
                </h2>
                <p className="mt-2 text-[13px] text-muted-foreground">
                  You will be the organiser. The app picks the play area around
                  you.
                </p>
                <Button
                  size="lg"
                  className="mt-5 h-11 uppercase tracking-[0.18em] w-full"
                  onClick={() => {
                    const form = useForm<CreateMatchValues>({
                      defaultValues: {
                        duration: RULES_CONFIG.matchDurationMinutes,
                        invigilators: RULES_CONFIG.invigilatorCount.min,
                      },
                      resolver: zodResolver(createMatchSchema),
                    });
                    createFormRef(form);
                  }}
                >
                  Create a room
                </Button>
              </div>

              <div className="flex-1 min-w-[220px] rounded-xl border border-hairline p-6">
                <h2 className="font-display text-xl tracking-tight">
                  Join a room
                </h2>
                <p className="mt-2 text-[13px] text-muted-foreground">
                  Enter a room code someone else made and choose how you appear
                  on the leaderboard.
                </p>
                <Button
                  size="lg"
                  variant="outline"
                  className="mt-5 h-11 uppercase tracking-[0.18em] w-full"
                  onClick={() => {
                    const form = useForm<JoinMatchValues>({
                      defaultValues: { roomCode: "", displayName: "", callSign: "" },
                      resolver: zodResolver(joinMatchSchema),
                    });
                    joinFormRef(form);
                  }}
                >
                  Join a room
                </Button>
              </div>
            </div>

            <p className="mt-10 max-w-xl text-[12px] leading-relaxed text-muted-foreground">
              The match timer can be anything from{" "}
              {RULES_CONFIG.eventWindowMinutes.min} to{" "}
              {RULES_CONFIG.eventWindowMinutes.max} minutes long, and every
              match runs with {RULES_CONFIG.invigilatorCount.min}–{RULES_CONFIG
                .invigilatorCount.max}{" "}
              invigilators. Live location, the shrinking zone and the real map
              arrive in later stages.
            </p>
          </>
        )}

        {view.kind === "creating" && (
          <div className="max-w-xl">
            <h1 className="font-display text-3xl tracking-tight">Create a room</h1>
            <p className="mt-2 text-[13px] text-muted-foreground">
              You are the organiser. Set the match length and the number of
              invigilators, then we will set up the room for you.
            </p>

            <div className="mt-8 rounded-xl border border-hairline p-6 space-y-6">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = view.form;
                  const values = form.getValues();
                  // Placeholder server path for Stage 2. Final wiring goes
                  // through a Convex mutation in the room module.
                  const created = createMatchPlaceholder(values);
                  setView({ kind: "created", roomCode: created.roomCode });
                }}
              >
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <DurationField />
                  <InvigilatorsField />
                </div>
                <div className="flex justify-end pt-2">
                  <Button type="submit" size="lg" className="h-11 uppercase tracking-[0.18em]">
                    Create room
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {view.kind === "created" && (created: any) => (
          <div className="max-w-xl text-center">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Room created
            </p>
            <h1 className="mt-3 font-display text-4xl tracking-tight">
              {created.roomCode}
            </h1>
            <p className="mt-4 text-[14px] text-muted-foreground">
              Share this code with the people who will play. They will join
              through it and wait in the lobby.
            </p>
            <div className="mt-8 flex justify-center">
              <CopyButton value={created.roomCode} />
            </div>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() => setView({ kind: "lobby", roomCode: created.roomCode, players: [] })}
              >
                Open the lobby
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() => setView({ kind: "choose" })}
              >
                Create another room
              </Button>
            </div>
          </div>
        )}

        {view.kind === "joining" && (
          <div className="max-w-xl">
            <h1 className="font-display text-3xl tracking-tight">Join a room</h1>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Type a five-character room code, then choose how you appear on the
              leaderboard.
            </p>

            <div className="mt-8 rounded-xl border border-hairline p-6 space-y-6">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = view.form;
                  const values = form.getValues();
                  // Placeholder server path for Stage 2.
                  setView({ kind: "joined", roomCode: values.roomCode.toUpperCase() });
                }}
              >
                <div className="grid grid-cols-1 gap-5">
                  <RoomCodeField />
                  <DisplayNameField />
                  <CallSignField />
                </div>
                <div className="flex justify-end pt-2">
                  <Button type="submit" size="lg" className="h-11 uppercase tracking-[0.18em]">
                    Join room
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {view.kind === "joined" && (joined: any) => (
          <div className="max-w-xl text-center">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Joined {joined.roomCode}
            </p>
            <h1 className="mt-3 font-display text-4xl tracking-tight">
              {joined.roomCode}
            </h1>
            <p className="mt-4 text-[14px] text-muted-foreground">
              You are in the lobby. The play area will be picked when the
              organiser starts the match.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Button
                asChild
                size="lg"
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() =>
                  setView({
                    kind: "lobby",
                    roomCode: joined.roomCode,
                    players: [],
                  })
                }
              >
                Open the lobby
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() => setView({ kind: "choose" })}
              >
                Back to start
              </Button>
            </div>
          </div>
        )}

        {view.kind === "lobby" && (lobby: any) => (
          <LobbyView roomCode={lobby.roomCode} players={lobby.players} />
        )}
      </main>
    </div>
  );
}

// Placeholder until we wire the real Convex mutations. Kept plain so the
// frontend works without a server for this stage.
function createMatchPlaceholder(values: CreateMatchValues) {
  const roomCode = "ABCDE"; // placeholder
  return {
    matchId: "placeholder",
    roomCode,
    zone: {
      centreLat: 51.5074,
      centreLng: -0.1278,
      initialRadiusMetres: RULES_CONFIG.radiusTable[RULES_CONFIG.radiusTable.length - 1].radiusMetres,
    },
  };
}
