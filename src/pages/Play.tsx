import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { UseFormReturn, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { RULES_CONFIG } from "@/convex/rules/config";

type CreateMatchValues = z.infer<typeof createMatchSchema>;
type JoinMatchValues = z.infer<typeof joinMatchSchema>;

type PlayerInLobby = {
  id: string;
  displayName: string;
  role: string;
};

type View =
  | { kind: "choose" }
  | { kind: "creating"; form: UseFormReturn<CreateMatchValues> }
  | { kind: "created"; roomCode: string }
  | { kind: "joining"; form: UseFormReturn<JoinMatchValues> }
  | { kind: "joined"; roomCode: string }
  | { kind: "lobby"; roomCode: string; players: PlayerInLobby[] };

const createMatchSchema = z.object({
  durationMinutes: z
    .number()
    .min(RULES_CONFIG.eventWindowMinutes.min)
    .max(RULES_CONFIG.eventWindowMinutes.max),
  invigilatorCount: z
    .number()
    .min(RULES_CONFIG.invigilatorCount.min)
    .max(RULES_CONFIG.invigilatorCount.max),
  displayNameMode: z.enum(["nickname", "real"]),
});

const joinMatchSchema = z.object({
  roomCode: z
    .string()
    .length(5)
    .max(5)
    .toUpperCase(),
  displayName: z
    .string()
    .min(1, "Choose a name for the leaderboard")
    .max(40),
  callSign: z
    .string()
    .min(1, "Choose a call sign")
    .max(24),
  displayNameMode: z.enum(["nickname", "real"]),
});

function DurationField({ form }: { form: UseFormReturn<CreateMatchValues> }) {
  return (
    <FormField
      control={form.control}
      name="durationMinutes"
      render={({ field }) => (
        <FormItem>
          <Label className="text-foreground">Match length</Label>
          <div className="relative">
            <Input
              type="number"
              min={RULES_CONFIG.eventWindowMinutes.min}
              max={RULES_CONFIG.eventWindowMinutes.max}
              {...field}
              className="uppercase tracking-[0.18em] text-[13px]"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[11px] uppercase tracking-[0.22em]">
              min
            </span>
          </div>
          <FormMessage />
          <p className="mt-1.5 text-[11px] text-muted-foreground uppercase tracking-[0.22em]">
            Organiser chooses any length between {RULES_CONFIG.eventWindowMinutes.min} and{" "}
            {RULES_CONFIG.eventWindowMinutes.max} minutes.
          </p>
        </FormItem>
      )}
    />
  );
}

function InvigilatorsField({ form }: { form: UseFormReturn<CreateMatchValues> }) {
  return (
    <FormField
      control={form.control}
      name="invigilatorCount"
      render={({ field }) => (
        <FormItem>
          <Label className="text-foreground">Invigilators</Label>
          <div className="relative">
            <Input
              type="number"
              min={RULES_CONFIG.invigilatorCount.min}
              max={RULES_CONFIG.invigilatorCount.max}
              {...field}
              className="uppercase tracking-[0.18em] text-[13px]"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[11px] uppercase tracking-[0.22em]">
              people
            </span>
          </div>
          <FormMessage />
          <p className="mt-1.5 text-[11px] text-muted-foreground uppercase tracking-[0.22em]">
            2–3 invigilators are named by the organiser at setup. They are not
            players and have no score.
          </p>
        </FormItem>
      )}
    />
  );
}

function RoomCodeField({ form }: { form: UseFormReturn<JoinMatchValues> }) {
  return (
    <FormField
      control={form.control}
      name="roomCode"
      render={({ field }) => (
        <FormItem>
          <Label className="text-foreground">Room code</Label>
          <Input
            {...field}
            maxLength={5}
            className="tracking-[0.32em] uppercase text-[14px]"
            placeholder="ABCDE"
          />
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function DisplayNameField({ form }: { form: UseFormReturn<JoinMatchValues> }) {
  return (
    <FormField
      control={form.control}
      name="displayName"
      render={({ field }) => (
        <FormItem>
          <Label className="text-foreground">Leaderboard name</Label>
          <Input
            {...field}
            className="uppercase tracking-[0.18em] text-[13px]"
            placeholder="How you appear on the leaderboard"
          />
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function CallSignField({ form }: { form: UseFormReturn<JoinMatchValues> }) {
  return (
    <FormField
      control={form.control}
      name="callSign"
      render={({ field }) => (
        <FormItem>
          <Label className="text-foreground">Call sign</Label>
          <Input
            {...field}
            className="uppercase tracking-[0.18em] text-[13px]"
            placeholder="What friends call you on the run"
          />
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard may be unavailable in some environments; ignore silently
    }
  }, [value]);

  return (
    <Button
      variant="outline"
      size="lg"
      className="h-11 uppercase tracking-[0.18em]"
      onClick={copy}
    >
      {copied ? "Copied" : "Copy room code"}
    </Button>
  );
}

function LobbyView({ roomCode, players }: { roomCode: string; players: PlayerInLobby[] }) {
  return (
    <div className="max-w-xl">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Lobby
        </p>
        <div className="flex items-center gap-3">
          <span className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Room
          </span>
          <code className="text-[14px] tracking-[0.32em] uppercase">
            {roomCode}
          </code>
          <CopyButton value={roomCode} />
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-hairline p-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground mb-3">
          Players waiting
        </p>
        {players.length === 0 ? (
          <p className="text-[13px] text-muted-foreground uppercase tracking-[0.18em]">
            No one has joined yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {players.map((p) => (
              <li
                key={p.id}
                className="flex justify-between rounded-lg border border-hairline px-3 py-2 text-[13px] uppercase tracking-[0.18em]"
              >
                <span className="text-foreground">{p.displayName}</span>
                <span className="text-muted-foreground">{p.role}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-4 text-center text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        Waiting for the organiser to start the match.
      </p>
    </div>
  );
}

export default function Play() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ kind: "choose" });

  const createForm = useForm<CreateMatchValues>({
    resolver: zodResolver(createMatchSchema),
    defaultValues: {
      durationMinutes: RULES_CONFIG.matchDurationMinutes,
      invigilatorCount: RULES_CONFIG.invigilatorCount.min,
      displayNameMode: "nickname",
    },
  });

  const joinForm = useForm<JoinMatchValues>({
    resolver: zodResolver(joinMatchSchema),
    defaultValues: {
      roomCode: "",
      displayName: "",
      callSign: "",
      displayNameMode: "nickname",
    },
  });

  const handleCreate = useCallback(
    (form: UseFormReturn<CreateMatchValues>) => {
      const values = form.getValues();
      // Placeholder server path for Stage 2 — the real create mutation is wired
      // behind the scenes when this route is served by the app shell.
      const roomCode = "ABCDE";
      setView({ kind: "created", roomCode });
    },
    [],
  );

  const handleJoin = useCallback(
    (form: UseFormReturn<JoinMatchValues>) => {
      const values = form.getValues();
      // Placeholder server path for Stage 2.
      setView({ kind: "joined", roomCode: values.roomCode });
    },
    [],
  );

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-10 text-foreground sm:px-6">
      <main className="mx-auto max-w-3xl">
        <header className="mb-10 text-center">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Shadow Hunt
          </p>
          <h1 className="mt-3 font-display text-4xl tracking-tight">
            {view.kind === "creating" || view.kind === "created" ? (
              <>Create a room</>
            ) : view.kind === "joining" || view.kind === "joined" ? (
              <>Join a room</>
            ) : (
              <>Join or create a room</>
            )}
          </h1>
          <p className="mt-2 max-w-md mx-auto text-[13px] text-muted-foreground">
            {view.kind === "choose" && (
              <>
                Start with either the organiser creating a room, or a player
                joining one through its five-character code.
              </>
            )}
            {view.kind === "creating" && (
              <>
                Set the match length and how many invigilators will watch the
                match. The organiser picks the play area when the match starts.
              </>
            )}
            {view.kind === "created" && (
              <>Share the room code with the people who will play. They will join through it and wait in the lobby.</>
            )}
            {view.kind === "joining" && (
              <>
                Type a five-character room code, then choose how you appear on the
                leaderboard.
              </>
            )}
            {view.kind === "joined" && (
              <>You are in the lobby. The play area will be picked when the organiser starts the match.</>
            )}
          </p>
        </header>

        {view.kind === "choose" && (
          <div className="grid gap-6 sm:grid-cols-2">
            <button
              type="button"
              className="group relative flex flex-col gap-3 rounded-xl border border-hairline p-6 text-left transition hover:border-foreground/20"
              onClick={() => {
                const form = useForm<CreateMatchValues>({
                  resolver: zodResolver(createMatchSchema),
                  defaultValues: {
                    durationMinutes: RULES_CONFIG.matchDurationMinutes,
                    invigilatorCount: RULES_CONFIG.invigilatorCount.min,
                    displayNameMode: "nickname",
                  },
                });
                setView({ kind: "creating", form });
              }}
            >
              <span className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Organiser
              </span>
              <span className="font-display text-2xl tracking-tight">
                Create a room
              </span>
              <span className="text-[13px] text-muted-foreground uppercase tracking-[0.18em]">
                Set the match length, invite 2–3 invigilators, then lock the
                roster and start.
              </span>
            </button>

            <button
              type="button"
              className="group relative flex flex-col gap-3 rounded-xl border border-hairline p-6 text-left transition hover:border-foreground/20"
              onClick={() => {
                const form = useForm<JoinMatchValues>({
                  resolver: zodResolver(joinMatchSchema),
                  defaultValues: {
                    roomCode: "",
                    displayName: "",
                    callSign: "",
                    displayNameMode: "nickname",
                  },
                });
                setView({ kind: "joining", form });
              }}
            >
              <span className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Player
              </span>
              <span className="font-display text-2xl tracking-tight">
                Join a room
              </span>
              <span className="text-[13px] text-muted-foreground uppercase tracking-[0.18em]">
                Enter the five-character code and choose your leaderboard name
                and call sign.
              </span>
            </button>
          </div>
        )}

        {view.kind === "creating" && (
          <div className="max-w-xl">
            <div className="rounded-xl border border-hairline p-6">
              <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground mb-4">
                Organiser setup
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCreate(createForm);
                }}
              >
                <div className="grid gap-5 sm:grid-cols-2">
                  <DurationField form={createForm} />
                  <InvigilatorsField form={createForm} />
                </div>
                <div className="mt-5 flex justify-end">
                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="h-11 uppercase tracking-[0.18em]"
                      onClick={() => setView({ kind: "choose" })}
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      size="lg"
                      className="h-11 uppercase tracking-[0.18em]"
                    >
                      Create room
                    </Button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {view.kind === "created" && (
          <div className="max-w-xl text-center">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Room created
            </p>
            <h1 className="mt-3 font-display text-4xl tracking-tight">
              {view.roomCode}
            </h1>
            <p className="mt-4 text-[14px] text-muted-foreground">
              Share this code with the people who will play. They will join
              through it and wait in the lobby.
            </p>
            <div className="mt-8 flex justify-center">
              <CopyButton value={view.roomCode} />
            </div>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Button
                type="button"
                size="lg"
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() =>
                  setView({
                    kind: "lobby",
                    roomCode: view.roomCode,
                    players: [],
                  })
                }
              >
                Open the lobby
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
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
            <div className="rounded-xl border border-hairline p-6">
              <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground mb-4">
                Join a room
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleJoin(joinForm);
                }}
              >
                <div className="grid gap-5">
                  <RoomCodeField form={joinForm} />
                  <DisplayNameField form={joinForm} />
                  <CallSignField form={joinForm} />
                </div>
                <div className="mt-5 flex justify-end">
                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="h-11 uppercase tracking-[0.18em]"
                      onClick={() => setView({ kind: "choose" })}
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      size="lg"
                      className="h-11 uppercase tracking-[0.18em]"
                    >
                      Join room
                    </Button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {view.kind === "joined" && (
          <div className="max-w-xl text-center">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Joined {view.roomCode}
            </p>
            <h1 className="mt-3 font-display text-4xl tracking-tight">
              {view.roomCode}
            </h1>
            <p className="mt-4 text-[14px] text-muted-foreground">
              You are in the lobby. The play area will be picked when the
              organiser starts the match.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Button
                type="button"
                size="lg"
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() =>
                  setView({
                    kind: "lobby",
                    roomCode: view.roomCode,
                    players: [],
                  })
                }
              >
                Open the lobby
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() => setView({ kind: "choose" })}
              >
                Back to start
              </Button>
            </div>
          </div>
        )}

        {view.kind === "lobby" && (
          <LobbyView roomCode={view.roomCode} players={view.players} />
        )}
      </main>
    </div>
  );
}
