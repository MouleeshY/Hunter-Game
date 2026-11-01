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
import { Briefing } from "@/components/match/Briefing";

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
  defaultCaptureMode: z.enum(["spectator", "hunter", "helper"]),
  proximityDetection: z.boolean(),
  /** Optional: shown on the public result page (Stage 6). */
  matchTitle: z.string().max(RULES_CONFIG.matchTitleMaxLength),
  clubName: z.string().max(RULES_CONFIG.clubNameMaxLength),
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
      defaultCaptureMode: RULES_CONFIG.defaultCaptureMode,
      proximityDetection: RULES_CONFIG.proximityDetectionEnabled,
      matchTitle: "",
      clubName: "",
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
        defaultCaptureMode: values.defaultCaptureMode,
        proximityDetection: values.proximityDetection,
        title: values.matchTitle,
        clubName: values.clubName,
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
              label="Match title (optional)"
              hint={`Up to ${RULES_CONFIG.matchTitleMaxLength} characters, shown on the public result`}
            >
              <Input
                autoComplete="off"
                placeholder="Autumn Night Run"
                {...form.register("matchTitle")}
              />
            </Field>
            <Field
              label="Club name (optional)"
              hint={`Up to ${RULES_CONFIG.clubNameMaxLength} characters; groups your results`}
            >
              <Input
                autoComplete="off"
                placeholder="Northside Runners"
                {...form.register("clubName")}
              />
            </Field>
          </div>
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
              label="After a Shadow is caught"
              hint="The default offer at capture; everyone still picks for themselves"
            >
              <div className="flex gap-2">
                {(
                  [
                    ["spectator", "Spectator"],
                    ["hunter", "Hunter"],
                    ["helper", "Helper"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    variant={
                      form.watch("defaultCaptureMode") === value
                        ? "default"
                        : "outline"
                    }
                    className="h-10 flex-1 uppercase tracking-[0.14em]"
                    onClick={() => form.setValue("defaultCaptureMode", value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </Field>
          </div>

          <label className="flex items-start gap-2 text-[13px] text-muted-foreground">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.watch("proximityDetection")}
              onChange={(event) =>
                form.setValue("proximityDetection", event.target.checked)
              }
            />
            <span>
              Proximity alerts — warn a Hunter and a Shadow when they come within{' '}
              {RULES_CONFIG.detectionRadiusMetres} m. Switch off to run a match
              without them.
            </span>
          </label>

          <div className="grid gap-5">
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
  setup: "Setup period — everyone to your starting position",
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
  const beginHeadStart = useMutation(api.rooms.beginHeadStartRoom);
  const extendSetup = useMutation(api.rooms.extendSetupRoom);
  const rerollCentre = useMutation(api.rooms.rerollCentreHandler);
  const endRoom = useMutation(api.rooms.endRoom);
  const abortRoom = useMutation(api.rooms.abortRoom);
  const pauseRoom = useMutation(api.rooms.pauseRoom);
  const resumeRoom = useMutation(api.rooms.resumeRoom);
  const publishResult = useMutation(api.results.publish);
  // Stage 6: the organiser's result link and publishing switch, once ended.
  const resultTools = useQuery(
    api.results.manage,
    lobby && lobby.me.isOrganiser && lobby.status === "ended" && lobby.matchId
      ? { matchId: lobby.matchId as never }
      : "skip",
  );
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forceStart, setForceStart] = useState(false);
  const [forceHeadStart, setForceHeadStart] = useState(false);
  const [abortOpen, setAbortOpen] = useState(false);
  const [abortReason, setAbortReason] = useState("");

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

      {lobby.me.playerId !== null && lobby.me.briefedAt === null && (
        <Briefing
          matchId={lobby.matchId as never}
          confirmedAt={lobby.me.briefedAt}
        />
      )}

      {(lobby.status === "lobby" ||
        lobby.status === "locked" ||
        lobby.status === "setup") && (
        <div className="rounded-xl border border-hairline p-6">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Match setup summary
          </p>
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {[
              ["Length", `${lobby.setup.matchDurationMinutes} minutes`],
              ["Head start", `${lobby.setup.headStartMinutes} minutes`],
              [
                "Pings",
                `every ${lobby.setup.pingIntervalMinutes} minutes`,
              ],
              [
                "Zone shrinks",
                `every ${lobby.setup.zoneShrinkIntervalMinutes} minutes`,
              ],
              [
                "Starting radius",
                `${Math.round(lobby.setup.initialRadiusMetres)} m`,
              ],
              [
                "Teams",
                `${lobby.setup.hunterCount} Hunters · ${lobby.setup.shadowCount} Shadows`,
              ],
              [
                "After a capture",
                lobby.setup.defaultCaptureMode === "hunter"
                  ? "join the Hunters (default)"
                  : lobby.setup.defaultCaptureMode === "helper"
                    ? "Helper (default)"
                    : "Spectator (default)",
              ],
              [
                "Proximity alerts",
                lobby.setup.proximityDetectionEnabled
                  ? `on within ${lobby.setup.detectionRadiusMetres} m`
                  : "off for this match",
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-3 border-b border-hairline pb-1 last:border-0"
              >
                <dt className="text-[13px] text-muted-foreground">{label}</dt>
                <dd className="text-[14px] font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[12px] text-muted-foreground">
            The organiser picks the length and the after-capture default at
            setup; the rest comes from the rules.
          </p>
        </div>
      )}

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
            {lobby.players.map((player: (typeof lobby.players)[number]) => (
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
            {lobby.invigilators.map((invigilator: (typeof lobby.invigilators)[number]) => (
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

      {lobby.paused && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-center text-amber-950">
          <p className="text-[11px] uppercase tracking-[0.2em]">Match paused</p>
          <p className="mt-1 text-[13px]">
            {lobby.pauseReason ?? "The clock and the zone are frozen."}
          </p>
        </div>
      )}

      {lobby.staff && (
        <div className="rounded-xl border border-hairline p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Staff board
            </p>
            <p className="text-[13px] text-muted-foreground">
              {lobby.staff.playerCount} players · {lobby.staff.briefedCount}{" "}
              of {lobby.staff.playerCount} confirmed the rules
            </p>
          </div>
          <ul className="mt-3 grid gap-1 sm:grid-cols-2">
            {lobby.staff.players.map((player: (typeof lobby.staff.players)[number]) => {
              const age =
                player.lastUploadAtMs === null
                  ? null
                  : Math.round((now - player.lastUploadAtMs) / 1000);
              const reports =
                age !== null && lobby.status !== "headstart" && age <= 30;
              return (
                <li
                  key={player.id}
                  className="flex items-center justify-between border-b border-hairline pb-1 text-[14px]"
                >
                  <span className="font-medium">{player.callSign}</span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-[2px] text-[10px] uppercase tracking-[0.14em] ${
                        player.briefedAt === null
                          ? "bg-amber-100 text-amber-900"
                          : "bg-emerald-100 text-emerald-900"
                      }`}
                    >
                      {player.briefedAt === null ? "Rules" : "Rules ✓"}
                    </span>
                    {lobby.status !== "headstart" && (
                      <span
                        className={`text-[11px] ${
                          reports || age === null
                            ? "text-muted-foreground"
                            : "font-semibold text-destructive"
                        }`}
                      >
                        {age === null
                          ? "Location off"
                          : reports
                            ? `Reporting · ${age}s`
                            : `Out of signal · ${age}s`}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {lobby.status === "setup" && lobby.setupEndsAt !== null && (
        <div className="rounded-xl border border-hairline p-6 text-center">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Setup period ends in
          </p>
          <p className="mt-1 font-display text-4xl tabular-nums">
            {formatClock(lobby.setupEndsAt - now)}
          </p>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Everyone to your starting position — the clock, the zone and the
            scoring are stopped. The spacing check is on the match screen.
          </p>
        </div>
      )}

      {lobby.status === "ended" && resultTools && (
        <div className="rounded-xl border border-hairline p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Public result
            </p>
            <p className="text-[12px] text-muted-foreground">
              {resultTools.public
                ? "Published — anyone with the link can read it"
                : resultTools.automatic
                  ? "Private — an aborted match is only published when you choose"
                  : "Hidden — only you can open it"}
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant={resultTools.public ? "outline" : "default"}
              size="lg"
              disabled={busy || !resultTools.canPublish}
              className="h-11 uppercase tracking-[0.18em]"
              onClick={() =>
                run(
                  () =>
                    publishResult({
                      matchId: resultTools.matchId as never,
                      publish: !resultTools.public,
                    }),
                  "Could not change the result's visibility.",
                )
              }
            >
              {resultTools.public ? "Unpublish result" : "Publish result"}
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-11 uppercase tracking-[0.18em]"
            >
              <Link to={`/results/${resultTools.slug}`}>
                Open result page
              </Link>
            </Button>
            <p className="text-[12px] text-muted-foreground">
              The result page has the QR code and the CSV download.
            </p>
          </div>
        </div>
      )}

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
                    "Could not start the setup period.",
                  )
                }
              >
                Start setup
              </Button>
              {forceStart ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-muted-foreground">
                    {lobby.pendingBriefings > 0
                      ? `${lobby.pendingBriefings} player${lobby.pendingBriefings === 1 ? " has" : "s have"} not confirmed the rules. Start anyway?`
                      : "Start the match anyway?"}
                  </span>
                  <Button
                    type="button"
                    size="lg"
                    disabled={busy}
                    className="h-11 uppercase tracking-[0.18em]"
                    onClick={() =>
                      void run(async () => {
                        await startRoom({
                          matchId: lobby.matchId as never,
                          force: true,
                        });
                        setForceStart(false);
                      }, "Could not start the setup period.")
                    }
                  >
                    Yes, start
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    className="h-11 uppercase tracking-[0.18em]"
                    onClick={() => setForceStart(false)}
                  >
                    Cancel
                  </Button>
                </span>
              ) : (
                !lobby.canStart &&
                lobby.pendingBriefings > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    disabled={busy}
                    className="h-11 uppercase tracking-[0.18em]"
                    onClick={() => setForceStart(true)}
                  >
                    Start anyway
                  </Button>
                )
              )}
            </>
          )}

        {lobby.me.isOrganiser && lobby.status === "setup" && (
          <>
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={busy}
              className="h-11 uppercase tracking-[0.18em]"
              onClick={() =>
                run(
                  () => extendSetup({ matchId: lobby.matchId as never }),
                  "Could not extend the setup period.",
                )
              }
            >
              Extend setup 1 min
            </Button>
            {forceHeadStart ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-muted-foreground">
                  Someone is too close or has no location. Start anyway?
                </span>
                <Button
                  type="button"
                  size="lg"
                  disabled={busy}
                  className="h-11 uppercase tracking-[0.18em]"
                  onClick={() =>
                    void run(async () => {
                      await beginHeadStart({
                        matchId: lobby.matchId as never,
                        force: true,
                      });
                      setForceHeadStart(false);
                    }, "Could not start the head start.")
                  }
                >
                  Yes, start anyway
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="h-11 uppercase tracking-[0.18em]"
                  onClick={() => setForceHeadStart(false)}
                >
                  Cancel
                </Button>
              </span>
            ) : (
              <Button
                type="button"
                size="lg"
                disabled={busy}
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() =>
                  void run(async () => {
                    try {
                      await beginHeadStart({ matchId: lobby.matchId as never });
                    } catch (cause) {
                      const message =
                        cause instanceof Error
                          ? cause.message
                          : "Could not start the head start.";
                      // The server names whoever is still too close or has no
                      // location; offer the confirmation the rules require.
                      if (message.includes("not clear yet")) {
                        setForceHeadStart(true);
                        return;
                      }
                      throw cause;
                    }
                  }, "Could not start the head start.")
                }
              >
                Start the head start
              </Button>
            )}
            <Button asChild variant="outline" size="lg" className="h-11 uppercase tracking-[0.18em]">
              <Link to={`/match/${lobby.roomCode}`}>Spacing check</Link>
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

      {(lobby.status === "setup" ||
        lobby.status === "headstart" ||
        lobby.status === "live") &&
        (lobby.me.isOrganiser || lobby.me.isInvigilator) && (
          <div className="flex flex-wrap justify-center gap-3">
            {lobby.me.isOrganiser && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={busy}
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() =>
                  run(
                    () =>
                      lobby.paused
                        ? resumeRoom({
                            matchId: lobby.matchId as never,
                            reason: "Resumed by the organiser.",
                          })
                        : pauseRoom({
                            matchId: lobby.matchId as never,
                            reason: "Paused by the organiser.",
                          }),
                    "Could not pause or resume.",
                  )
                }
              >
                {lobby.paused ? "Resume match" : "Pause match"}
              </Button>
            )}
            {lobby.me.isOrganiser && (
              <Button
                type="button"
                size="lg"
                disabled={busy}
                className="h-11 uppercase tracking-[0.18em]"
                onClick={() =>
                  run(
                    () =>
                      endRoom({
                        matchId: lobby.matchId as never,
                        reason: "Ended by the organiser.",
                      }),
                    "Could not end the match.",
                  )
                }
              >
                End match
              </Button>
            )}
            {abortOpen ? (
              <span className="grid w-full gap-2">
                <label className="text-center text-[13px] text-muted-foreground">
                  Reason (required) — no winner, no bonuses; points already
                  earned are kept.
                </label>
                <span className="flex flex-wrap justify-center gap-2">
                  <Input
                    value={abortReason}
                    placeholder="Why is this being aborted?"
                    onChange={(event) => setAbortReason(event.target.value)}
                    className="max-w-sm"
                  />
                  <Button
                    type="button"
                    size="lg"
                    disabled={busy || abortReason.trim().length === 0}
                    className="h-11 uppercase tracking-[0.18em]"
                    onClick={() =>
                      void run(async () => {
                        await abortRoom({
                          matchId: lobby.matchId as never,
                          reason: abortReason.trim(),
                        });
                        setAbortOpen(false);
                        setAbortReason("");
                      }, "Could not abort the match.")
                    }
                  >
                    Abort match
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    className="h-11 uppercase tracking-[0.18em]"
                    onClick={() => setAbortOpen(false)}
                  >
                    Cancel
                  </Button>
                </span>
              </span>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={busy}
                className="h-11 uppercase tracking-[0.18em] text-destructive hover:text-destructive"
                onClick={() => setAbortOpen(true)}
              >
                Abort match
              </Button>
            )}
          </div>
        )}

      {(lobby.status === "setup" || lobby.status === "headstart") &&
        lobby.me.isOrganiser &&
        abortOpen && (
          <div className="flex flex-wrap justify-center gap-2">
            <Input
              value={abortReason}
              placeholder="Reason for aborting (required)"
              onChange={(event) => setAbortReason(event.target.value)}
              className="max-w-sm"
            />
            <Button
              type="button"
              size="lg"
              disabled={busy || abortReason.trim().length === 0}
              className="h-11 uppercase tracking-[0.18em]"
              onClick={() =>
                void run(async () => {
                  await abortRoom({
                    matchId: lobby.matchId as never,
                    reason: abortReason.trim(),
                  });
                  setAbortOpen(false);
                  setAbortReason("");
                }, "Could not abort the match.")
              }
            >
              Abort match
            </Button>
          </div>
        )}

      {lobby.me.isOrganiser && !lobby.canStart && lobby.startBlockedReason && (
        <p className="text-center text-[12px] text-muted-foreground">
          {lobby.startBlockedReason}
        </p>
      )}
    </div>
  );
}

/** Seconds left, as m:ss. */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
