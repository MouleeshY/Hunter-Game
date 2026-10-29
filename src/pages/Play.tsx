import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RULES_CONFIG } from "@/rules/config";
import { GameMap } from "@/components/map/GameMap";

/* ------------------------------------------------------------------ *
 * Schemas\n * ------------------------------------------------------------------ */

const createMatchSchema = z.object({
  durationMinutes: z
    .number()
    .int()
    .min(RULES_CONFIG.matchDurationRangeMinutes.min)
    .max(RULES_CONFIG.matchDurationRangeMinutes.max),
  organiserLat: z.number().min(-90).max(90),
  organiserLng: z.number().min(-180).max(180),
  invigilatorOne: z.string().min(2, "Name the first invigilator."),
  invigilatorTwo: z.string().min(2, "Name the second invigilator."),
  invigilatorThree: z.string().optional(),
});

const joinMatchSchema = z.object({
  roomCode: z.string().min(RULES_CONFIG.roomCodeLength),
  callSign: z.string().min(2, "Pick a call sign.").max(24),
  displayName: z.string().min(2, "Pick a leaderboard name.").max(32),
  displayNameMode: z.enum(["nickname", "real"]),
});

type CreateMatchValues = z.infer<typeof createMatchSchema>;
type JoinMatchValues = z.infer<typeof joinMatchSchema>;

/* ------------------------------------------------------------------ *
 * Small pieces\n * ------------------------------------------------------------------ */

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      className="h-10 uppercase tracking-[0.18em]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : "Copy code"}
    </Button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/* ------------------------------------------------------------------ *
 * Create form — useForm lives at the top level of this component\n * ------------------------------------------------------------------ */

function CreateRoomForm({
  onCreated,
  onBack,
}: {
  onCreated: (roomCode: string) => void;
  onBack: () => void;
}) {
  const createRoom = useMutation(api.rooms.createRoom);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CreateMatchValues>({
    resolver: zodResolver(createMatchSchema),
    defaultValues: {
      durationMinutes: RULES_CONFIG.matchDurationMinutes,
      organiserLat: 51.5074,
      organiserLng: -0.1278,
      invigilatorOne: "",
      invigilatorTwo: "",
      invigilatorThree: "",
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    setSubmitting(true);
    try {
      const names = [
        values.invigilatorOne,
        values.invigilatorTwo,
        values.invigilatorThree ?? "",
      ].filter((name) => name.trim().length > 0);
      const created = await createRoom({
        matchDurationMinutes: values.durationMinutes,
        organiserLat: values.organiserLat,
        organiserLng: values.organiserLng,
        invigilatorNames: names,
      });
      onCreated(created.roomCode);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create the room.",
      );
    } finally {
      setSubmitting(false);
    }
  });

  const { errors } = form.formState;

  return (
    <div className="rounded-xl border border-hairline p-6">
      <p className="mb-4 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        Organiser setup
      </p>
      <form onSubmit={submit}>
        <div className="grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Match length (minutes)"
              hint={`${RULES_CONFIG.matchDurationRangeMinutes.min}–${RULES_CONFIG.matchDurationRangeMinutes.max} minutes`}
            >
              <Input
                type="number"
                min={RULES_CONFIG.matchDurationRangeMinutes.min}
                max={RULES_CONFIG.matchDurationRangeMinutes.max}
                {...form.register("durationMinutes", { valueAsNumber: true })}
              />
            </Field>
            <Field
              label="Invigilators"
              hint={`${RULES_CONFIG.invigilatorCount.min}–${RULES_CONFIG.invigilatorCount.max} named people, not players`}
            >
              <div className="grid gap-2">
                <Input
                  placeholder="Invigilator one"
                  {...form.register("invigilatorOne")}
                />
                <Input
                  placeholder="Invigilator two"
                  {...form.register("invigilatorTwo")}
                />
                <Input
                  placeholder="Invigilator three (optional)"
                  {...form.register("invigilatorThree")}
                />
              </div>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Organiser latitude"
              hint={`Centre is picked within ${RULES_CONFIG.centrePickDistanceMetres} m of this point`}
            >
              <Input
                type="number"
                step="0.0001"
                {...form.register("organiserLat", { valueAsNumber: true })}
              />
            </Field>
            <Field label="Organiser longitude">
              <Input
                type="number"
                step="0.0001"
                {...form.register("organiserLng", { valueAsNumber: true })}
              />
            </Field>
          </div>

          {(errors.invigilatorOne ?? errors.invigilatorTwo) && (
            <p className="text-[12px] text-destructive">
              {errors.invigilatorOne?.message ?? errors.invigilatorTwo?.message}
            </p>
          )}
          {error && <p className="text-[12px] text-destructive">{error}</p>}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 uppercase tracking-[0.18em]"
              onClick={onBack}
            >
              Back
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={submitting}
              className="h-11 uppercase tracking-[0.18em]"
            >
              {submitting ? "Creating…" : "Create room"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Join form — useForm lives at the top level of this component\n * ------------------------------------------------------------------ */

function JoinRoomForm({
  onJoined,
  onBack,
}: {
  onJoined: (roomCode: string) => void;
  onBack: () => void;
}) {
  const joinRoom = useMutation(api.rooms.joinRoom);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<JoinMatchValues>({
    resolver: zodResolver(joinMatchSchema),
    defaultValues: {
      roomCode: "",
      callSign: "",
      displayName: "",
      displayNameMode: "nickname",
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    setSubmitting(true);
    try {
      const joined = await joinRoom({
        roomCode: values.roomCode,
        callSign: values.callSign,
        displayName: values.displayName,
        displayNameMode: values.displayNameMode,
      });
      onJoined(joined.roomCode);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not join the room.",
      );
    } finally {
      setSubmitting(false);
    }
  });

  const [mode, setMode] = useState<"nickname" | "real">("nickname");
  const { errors } = form.formState;

  return (
    <div className="rounded-xl border border-hairline p-6">
      <p className="mb-4 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        Join a room
      </p>
      <form onSubmit={submit}>
        <div className="grid gap-5">
          <Field
            label="Room code"
            hint={`${RULES_CONFIG.roomCodeLength} characters, given by the organiser`}
          >
            <Input
              autoComplete="off"
              className="uppercase tracking-[0.3em]"
              maxLength={RULES_CONFIG.roomCodeLength}
              {...form.register("roomCode")}
            />
          </Field>
          {errors.roomCode && (
            <p className="text-[12px] text-destructive">
              {errors.roomCode.message}
            </p>
          )}

          <Field label="Call sign" hint="What other players see in the lobby">
            <Input autoComplete="off" {...form.register("callSign")} />
          </Field>
          {errors.callSign && (
            <p className="text-[12px] text-destructive">
              {errors.callSign.message}
            </p>
          )}

          <Field label="Leaderboard name">
            <Input autoComplete="off" {...form.register("displayName")} />
          </Field>
          {errors.displayName && (
            <p className="text-[12px] text-destructive">
              {errors.displayName.message}
            </p>
          )}

          <div className="grid gap-2">
            <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Show on the leaderboard
            </Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === "nickname" ? "default" : "outline"}
                className="h-10 flex-1 uppercase tracking-[0.18em]"
                onClick={() => {
                  setMode("nickname");
                  form.setValue("displayNameMode", "nickname");
                }}
              >
                Nickname
              </Button>
              <Button
                type="button"
                variant={mode === "real" ? "default" : "outline"}
                className="h-10 flex-1 uppercase tracking-[0.18em]"
                onClick={() => {
                  setMode("real");
                  form.setValue("displayNameMode", "real");
                }}
              >
                Real name
              </Button>
            </div>
          </div>

          {error && <p className="text-[12px] text-destructive">{error}</p>}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 uppercase tracking-[0.18em]"
              onClick={onBack}
            >
              Back
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={submitting}
              className="h-11 uppercase tracking-[0.18em]"
            >
              {submitting ? "Joining…" : "Join room"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Lobby\n * ------------------------------------------------------------------ */

const STATUS_COPY: Record<string, string> = {
  lobby: "Lobby open — players can still join",
  locked: "Roster locked — no one else can join",
  headstart: "Head start running — pings begin when it ends",
  live: "Match live",
  ended: "Match ended",
};

function LobbyView({
  roomCode,
  onLeave,
}: {
  roomCode: string;
  onLeave: () => void;
}) {
  const lobby = useQuery(api.rooms.lobby, { roomCode });
  const lockRoster = useMutation(api.rooms.lockRoster);
  const startRoom = useMutation(api.rooms.startRoom);
  const rerollCentre = useMutation(api.rooms.rerollCentreHandler);
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (lobby === undefined) {
    return (
      <p className="text-center text-[13px] uppercase tracking-[0.18em] text-muted-foreground">
        Loading the lobby…
      </p>
    );
  }
  if (lobby === null) {
    return (
      <p className="text-center text-[13px] text-muted-foreground">
        That room is no longer available.
      </p>
    );
  }

  const headStartLeft =
    lobby.headStartEndsAt === null
      ? null
      : Math.max(0, lobby.headStartEndsAt - now);

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-8">
      <div className="rounded-xl border border-hairline p-6 text-center">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Room code
        </p>
        <p className="mt-2 font-display text-5xl tracking-[0.16em]">
          {lobby.roomCode}
        </p>
        <div className="mt-5 flex justify-center">
          <CopyButton value={lobby.roomCode} />
        </div>
        <p className="mt-5 text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
          {STATUS_COPY[lobby.status] ?? lobby.status}
        </p>
        {lobby.status === "headstart" && headStartLeft !== null && (
          <p className="mt-1 text-[13px] text-muted-foreground">
            Pings in {Math.ceil(headStartLeft / 1000)}s
          </p>
        )}
        {lobby.startedAt !== null && lobby.endsAt !== null && (
          <p className="mt-1 text-[12px] text-muted-foreground">
            Timer ends {new Date(lobby.endsAt).toLocaleTimeString()}
          </p>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-xl border border-hairline p-6">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Players
            </p>
            <p className="text-[12px] text-muted-foreground">
              {lobby.playerCount} / {lobby.softCapPlayers} · min{" "}
              {lobby.minPlayers}
            </p>
          </div>
          <ul className="mt-4 grid gap-2">
            {lobby.players.length === 0 && (
              <li className="text-[13px] text-muted-foreground">
                No one has joined yet.
              </li>
            )}
            {lobby.players.map((player) => (
              <li
                key={player.id}
                className="flex items-center justify-between border-b border-hairline pb-2 text-[14px] last:border-0"
              >
                <span>{player.callSign}</span>
                {player.id === lobby.me.playerId && (
                  <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    You
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-hairline p-6">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Invigilators
          </p>
          <ul className="mt-4 grid gap-3">
            {lobby.invigilators.map((invigilator) => (
              <li key={invigilator.displayName} className="text-[14px]">
                <p>{invigilator.displayName}</p>
                {invigilator.inviteCode ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="rounded border border-hairline px-2 py-1 text-[12px] tracking-[0.16em]">
                      {invigilator.inviteCode}
                    </code>
                    <Link
                      to={`/monitor?code=${invigilator.inviteCode}`}
                      className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground underline decoration-hairline underline-offset-4"
                    >
                      Invite link
                    </Link>
                  </div>
                ) : (
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Invited
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-xl border border-hairline p-6">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Play area
          </p>
          {lobby.me.isOrganiser &&
            (lobby.status === "lobby" || lobby.status === "locked") && (
              <Button
                type="button"
                variant="outline"
                className="h-9 uppercase tracking-[0.18em]"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      rerollCentre({ matchId: lobby.matchId as never }),
                    "Could not re-roll the play area.",
                  )
                }
              >
                Re-roll
              </Button>
            )}
        </div>
        <p className="mt-2 font-mono text-[13px]">
          {lobby.zone.centreLat.toFixed(5)}, {lobby.zone.centreLng.toFixed(5)}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Starting radius {Math.round(lobby.zone.initialRadiusMetres)} m ·{" "}
          {lobby.matchDurationMinutes} minute match
        </p>
        <GameMap
          centre={{
            lat: lobby.zone.centreLat,
            lng: lobby.zone.centreLng,
          }}
          radiusMetres={lobby.zone.initialRadiusMetres}
          className="mt-4 h-56"
        />
        <div className="mt-4 flex justify-end">
          <Button asChild variant="outline" className="h-9 uppercase tracking-[0.18em]">
            <Link to={`/match/${lobby.roomCode}`}>Open match map</Link>
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-center text-[12px] text-destructive">{error}</p>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        {lobby.me.isOrganiser &&
          (lobby.status === "lobby" || lobby.status === "locked") && (
            <>
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={busy}
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() =>
                  run(
                    () =>
                      lockRoster({
                        matchId: lobby.matchId as never,
                        locked: lobby.status === "lobby",
                      }),
                    "Could not change the roster lock.",
                  )
                }
              >
                {lobby.status === "lobby" ? "Lock roster" : "Unlock roster"}
              </Button>
              <Button
                type="button"
                size="lg"
                disabled={!lobby.canStart || busy}
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() =>
                  run(
                    () => startRoom({ matchId: lobby.matchId as never }),
                    "Could not start the match.",
                  )
                }
              >
                Start match
              </Button>
            </>
          )}
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11 uppercase tracking-[0.18em]"
          onClick={onLeave}
        >
          Leave
        </Button>
      </div>
      {lobby.me.isOrganiser && !lobby.canStart && lobby.startBlockedReason && (
        <p className="text-center text-[12px] text-muted-foreground">
          {lobby.startBlockedReason}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Page\n * ------------------------------------------------------------------ */

type View = "choose" | "creating" | "joining" | "lobby";

export default function Play() {
  const [view, setView] = useState<View>("choose");
  const [roomCode, setRoomCode] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-10 text-foreground sm:px-6">
      <main className="mx-auto max-w-3xl">
        <header className="mb-10 text-center">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Shadow Hunt
          </p>
          <h1 className="mt-3 font-display text-4xl tracking-tight">
            {view === "lobby" ? "The lobby" : "Join or create a room"}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-[13px] text-muted-foreground">
            {view === "lobby"
              ? "Everyone here sees the same live roster. The organiser locks it and starts the head start."
              : "The organiser creates a room; everyone else joins with its five-character code."}
          </p>
        </header>

        {view === "choose" && (
          <div className="grid gap-6 sm:grid-cols-2">
            <button
              type="button"
              className="flex flex-col gap-3 rounded-xl border border-hairline p-6 text-left transition hover:border-foreground/20"
              onClick={() => setView("creating")}
            >
              <span className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Organiser
              </span>
              <span className="font-display text-2xl tracking-tight">
                Create a room
              </span>
              <span className="text-[13px] uppercase tracking-[0.18em] text-muted-foreground">
                Set the length, name 2–3 invigilators, pick the play area.
              </span>
            </button>
            <button
              type="button"
              className="flex flex-col gap-3 rounded-xl border border-hairline p-6 text-left transition hover:border-foreground/20"
              onClick={() => setView("joining")}
            >
              <span className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Player
              </span>
              <span className="font-display text-2xl tracking-tight">
                Join a room
              </span>
              <span className="text-[13px] uppercase tracking-[0.18em] text-muted-foreground">
                Enter the code, choose a call sign and a leaderboard name.
              </span>
            </button>
          </div>
        )}

        {view === "creating" && (
          <CreateRoomForm
            onBack={() => setView("choose")}
            onCreated={(code) => {
              setRoomCode(code);
              setView("lobby");
            }}
          />
        )}

        {view === "joining" && (
          <JoinRoomForm
            onBack={() => setView("choose")}
            onJoined={(code) => {
              setRoomCode(code);
              setView("lobby");
            }}
          />
        )}

        {view === "lobby" && roomCode && (
          <LobbyView
            roomCode={roomCode}
            onLeave={() => {
              setRoomCode(null);
              setView("choose");
            }}
          />
        )}
      </main>
    </div>
  );
}
