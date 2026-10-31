import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GameMap, type MapMarkerInput } from "@/components/map/GameMap";
import type { PlayerMode } from "@/rules/types";

/* ------------------------------------------------------------------ *
 * Invite entry
 * ------------------------------------------------------------------ */

function InviteGate() {
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [error, setError] = useState<string | null>(null);
  const acceptInvite = useMutation(api.rooms.acceptInvite);

  const trimmed = code.trim().toUpperCase();
  const preview = useQuery(
    api.rooms.invitePreview,
    trimmed.length > 0 ? { inviteCode: trimmed } : "skip",
  );

  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-hairline p-6">
      <div className="grid gap-2">
        <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Invite code
        </Label>
        <Input
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            void setParams(
              event.target.value ? { code: event.target.value } : {},
              { replace: true },
            );
          }}
          placeholder="Six-character invite code"
          className="uppercase tracking-[0.24em]"
        />
      </div>

      {trimmed.length > 0 && preview === undefined && (
        <p className="mt-4 text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
          Checking invite…
        </p>
      )}
      {preview === null && (
        <p className="mt-4 text-[12px] text-destructive">
          That invite code is not valid.
        </p>
      )}
      {preview && preview !== undefined && (
        <div className="mt-4 border-t border-hairline pt-4 text-[14px]">
          <p>
            {preview.displayName} · room{" "}
            <span className="tracking-[0.16em]">{preview.roomCode}</span>
          </p>
          <p className="mt-1 text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
            {preview.status}
          </p>
        </div>
      )}

      {error && <p className="mt-4 text-[12px] text-destructive">{error}</p>}

      <div className="mt-6 flex justify-end gap-3">
        <Button
          asChild
          variant="outline"
          size="lg"
          className="h-11 uppercase tracking-[0.18em]"
        >
          <Link to="/play">Back</Link>
        </Button>
        <Button
          type="button"
          size="lg"
          disabled={preview == null}
          className="h-11 uppercase tracking-[0.18em]"
          onClick={async () => {
            setError(null);
            try {
              const result = await acceptInvite({ inviteCode: trimmed });
              await setParams({ match: result.matchId });
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not accept the invite.",
              );
            }
          }}
        >
          Open console
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Confirmation bar — every action asks why, and writes it to the log
 * ------------------------------------------------------------------ */

type PendingAction = {
  kind:
    | "dismiss"
    | "force"
    | "warn"
    | "remove"
    | "mode"
    | "pause"
    | "resume";
  label: string;
  detail?: string;
  playerIds?: { hunterId?: string; shadowId?: string; playerId?: string };
  mode?: PlayerMode;
};

function ConfirmBar({
  action,
  busy,
  onConfirm,
  onCancel,
}: {
  action: PendingAction;
  busy: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const needsReason = action.kind !== "pause" && action.kind !== "resume";

  return (
    <div className="rounded-xl border border-foreground/25 p-4">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        Confirm
      </p>
      <p className="mt-1 text-[15px]">{action.label}</p>
      {action.detail && (
        <p className="mt-1 text-[13px] text-muted-foreground">
          {action.detail}
        </p>
      )}
      <div className="mt-3 grid gap-2">
        <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {needsReason ? "Why (written to the audit log)" : "Note (optional)"}
        </Label>
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={needsReason ? "Reason" : "Optional note"}
        />
      </div>
      <div className="mt-4 flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-10 uppercase tracking-[0.18em]"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy || (needsReason && reason.trim().length === 0)}
          className="h-10 uppercase tracking-[0.18em]"
          onClick={() => onConfirm(reason.trim())}
        >
          {busy ? "Working…" : "Confirm"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Console
 * ------------------------------------------------------------------ */

const TONE: Record<string, string> = {
  hunter_active: "#1c1b19",
  shadow_active: "#b8865b",
  helper: "#4a6b57",
  tagged: "#4a6b57",
  out: "#8a867e",
  removed: "#b03a2e",
};

function toneFor(player: {
  role: string;
  status: string;
  mode: string;
}): string {
  if (player.status === "removed") return TONE.removed;
  if (
    player.status === "tagged" ||
    player.status === "spectator" ||
    player.status === "eliminated"
  ) {
    return player.mode === "helper" ? TONE.helper : TONE.tagged;
  }
  return player.role === "hunter" ? TONE.hunter_active : TONE.shadow_active;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const ACTION_COPY: Record<PendingAction["kind"], string> = {
  dismiss: "Dismiss this complaint",
  force: "Force the tag",
  warn: "Warn this player",
  remove: "Remove this player from the match",
  mode: "Change this player's mode",
  pause: "Pause the whole match",
  resume: "Resume the match",
};

function Console({ matchId, onLeave }: { matchId: string; onLeave: () => void }) {
  const view = useQuery(api.monitor.view, {
    matchId: matchId as Id<"matches">,
  });
  const dismiss = useMutation(api.monitor.dismiss);
  const force = useMutation(api.monitor.force);
  const warn = useMutation(api.monitor.warn);
  const remove = useMutation(api.monitor.remove);
  const changeMode = useMutation(api.monitor.changeMode);
  const pause = useMutation(api.monitor.pause);
  const resume = useMutation(api.monitor.resume);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Countdowns follow the server clock, measured when data arrives.
  const [offset, setOffset] = useState(0);
  const serverNow = view?.serverNowMs ?? null;
  useEffect(() => {
    if (serverNow !== null) setOffset(serverNow - Date.now());
  }, [serverNow]);
  const [, setSecond] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSecond((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const now = serverNow !== null && view?.paused ? serverNow : Date.now() + offset;

  if (view === undefined) {
    return (
      <p className="text-center text-[13px] uppercase tracking-[0.18em] text-muted-foreground">
        Opening the console…
      </p>
    );
  }
  if (view === null) {
    return (
      <div className="text-center">
        <p className="text-[13px] text-destructive">
          Only an invigilator for this match can open the console.
        </p>
        <div className="mt-6 flex justify-center">
          <Button asChild variant="outline">
            <Link to="/play">Back to rooms</Link>
          </Button>
        </div>
      </div>
    );
  }

  const markers: MapMarkerInput[] = view.players
    .filter((player) => player.lat !== null && player.lng !== null)
    .map((player) => ({
      id: player.playerId,
      lat: player.lat!,
      lng: player.lng!,
      kind: "live" as const,
      label: `${player.callSign}${player.flagged ? " ⚑" : ""}`,
      ageMs: player.lastSeenAtMs === null ? 0 : Math.max(0, now - player.lastSeenAtMs),
      accuracyMetres: player.accuracyMetres,
      tone: toneFor(player),
    }));

  const run = async (action: PendingAction, reason: string) => {
    setError(null);
    setBusy(true);
    try {
      if (action.kind === "dismiss") {
        await dismiss({
          matchId: matchId as Id<"matches">,
          complaintId: action.playerIds!.playerId as Id<"complaints">,
          reason,
        });
      } else if (action.kind === "force") {
        await force({
          matchId: matchId as Id<"matches">,
          hunterId: action.playerIds!.hunterId as Id<"players">,
          shadowId: action.playerIds!.shadowId as Id<"players">,
          reason,
        });
      } else if (action.kind === "warn") {
        await warn({
          matchId: matchId as Id<"matches">,
          playerId: action.playerIds!.playerId as Id<"players">,
          reason,
        });
      } else if (action.kind === "remove") {
        await remove({
          matchId: matchId as Id<"matches">,
          playerId: action.playerIds!.playerId as Id<"players">,
          reason,
        });
      } else if (action.kind === "mode") {
        await changeMode({
          matchId: matchId as Id<"matches">,
          playerId: action.playerIds!.playerId as Id<"players">,
          mode: action.mode!,
          reason,
        });
      } else if (action.kind === "pause") {
        await pause({ matchId: matchId as Id<"matches">, reason });
      } else if (action.kind === "resume") {
        await resume({ matchId: matchId as Id<"matches">, reason });
      }
      setPending(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That action failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Invigilator · {view.invigilatorName}
          </p>
          <h1 className="mt-2 font-display text-3xl tracking-tight">
            Room {view.roomCode}
          </h1>
          <p className="mt-1 text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
            {view.status}
            {view.paused ? " · paused" : ""}
          </p>
        </div>
        <div className="flex gap-3">
          {view.paused ? (
            <Button
              type="button"
              className="h-10 uppercase tracking-[0.18em]"
              disabled={busy}
              onClick={() =>
                setPending({ kind: "resume", label: ACTION_COPY.resume })
              }
            >
              Resume
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="h-10 uppercase tracking-[0.18em]"
              disabled={busy || view.status === "ended" || view.status === "lobby" || view.status === "locked"}
              onClick={() => setPending({ kind: "pause", label: ACTION_COPY.pause })}
            >
              Pause
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="h-10 uppercase tracking-[0.18em]"
            onClick={onLeave}
          >
            Leave
          </Button>
        </div>
      </header>

      {view.paused && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <p className="text-[11px] uppercase tracking-[0.2em]">Paused</p>
          <p className="mt-1 text-[14px]">
            {view.pauseReason ??
              "Clock, zone shrink and drain are frozen for everyone."}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-hairline p-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Zone shrinks in
          </p>
          <p className="mt-1 font-display text-2xl">
            {view.zone.nextShrinkAtMs === null
              ? "—"
              : formatClock(view.zone.nextShrinkAtMs - now)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Radius {Math.round(view.zone.radiusMetres)} m
          </p>
        </div>
        <div className="rounded-xl border border-hairline p-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Match timer
          </p>
          <p className="mt-1 font-display text-2xl">
            {view.endsAt === null ? "—" : formatClock(view.endsAt - now)}
          </p>
        </div>
        <div className="rounded-xl border border-hairline p-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Open complaints
          </p>
          <p className="mt-1 font-display text-2xl">
            {view.complaints.filter((row) => row.status === "open").length}
          </p>
        </div>
      </div>

      <GameMap
        centre={{ lat: view.zone.centreLat, lng: view.zone.centreLng }}
        radiusMetres={view.zone.radiusMetres}
        markers={markers}
        className="h-[420px]"
      />

      <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        Legend
      </p>
      <div className="flex flex-wrap gap-4 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: TONE.shadow_active }}
          />
          Shadow in play
        </span>
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: TONE.hunter_active }}
          />
          Hunter
        </span>
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: TONE.tagged }}
          />
          Captured
        </span>
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: TONE.helper }}
          />
          Helper
        </span>
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: TONE.removed }}
          />
          Removed
        </span>
        <span>⚑ spoof flag</span>
      </div>

      {error && <p className="text-[12px] text-destructive">{error}</p>}

      {pending && (
        <ConfirmBar
          action={pending}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={(reason) => void run(pending, reason)}
        />
      )}

      {/* ---- Complaint queue ------------------------------------------------ */}
      <section className="rounded-xl border border-hairline p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Complaint queue
          </h2>
          <span className="text-[12px] text-muted-foreground">
            Oldest first
          </span>
        </div>

        {view.complaints.length === 0 && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            No complaints filed.
          </p>
        )}

        <ul className="mt-4 grid gap-4">
          {view.complaints.map((row) => {
            const overdue =
              row.status === "open" && now > row.responseDueAtMs;
            return (
              <li key={row.id} className="rounded-lg border border-hairline p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[15px]">
                    <strong>{row.hunterCallSign}</strong> reported{" "}
                    <strong>{row.shadowCallSign}</strong>
                  </p>
                  {row.status === "open" ? (
                    <span
                      className={`text-[12px] uppercase tracking-[0.16em] ${
                        overdue ? "font-semibold text-red-600" : "text-muted-foreground"
                      }`}
                    >
                      {overdue
                        ? "OVERDUE"
                        : `answers in ${formatClock(row.responseDueAtMs - now)}`}
                    </span>
                  ) : (
                    <span className="text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
                      {row.status}
                    </span>
                  )}
                </div>

                <div className="mt-3 grid gap-1 text-[13px] text-muted-foreground sm:grid-cols-2">
                  <span>Age {formatClock(row.ageMs)}</span>
                  <span>
                    Distance{" "}
                    {row.distanceMetres === null
                      ? "unknown"
                      : `${row.distanceMetres} m`}
                  </span>
                  <span className="font-mono text-[12px]">
                    {row.hunterLat === null
                      ? "Hunter: no fix"
                      : `Hunter ${row.hunterLat.toFixed(5)}, ${row.hunterLng!.toFixed(5)}`}
                  </span>
                  <span className="font-mono text-[12px]">
                    {row.shadowLat === null
                      ? "Shadow: no fix"
                      : `Shadow ${row.shadowLat.toFixed(5)}, ${row.shadowLng!.toFixed(5)}`}
                  </span>
                </div>
                {row.note && (
                  <p className="mt-2 text-[13px]">“{row.note}”</p>
                )}

                {row.status === "open" && pending === null && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 uppercase tracking-[0.16em]"
                      onClick={() =>
                        setPending({
                          kind: "force",
                          label: ACTION_COPY.force,
                          detail: `${row.hunterCallSign} tags ${row.shadowCallSign}. Scores like a normal tag; distance and freshness are bypassed.`,
                          playerIds: {
                            hunterId: row.hunterId,
                            shadowId: row.shadowId,
                          },
                        })
                      }
                    >
                      Force tag
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 uppercase tracking-[0.16em]"
                      onClick={() =>
                        setPending({
                          kind: "dismiss",
                          label: ACTION_COPY.dismiss,
                          detail: `${row.hunterCallSign} reported ${row.shadowCallSign}. Nothing changes for either player.`,
                          playerIds: { playerId: row.id },
                        })
                      }
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---- Player list ---------------------------------------------------- */}
      <section className="rounded-xl border border-hairline p-5">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Players
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <th className="py-2 pr-3">Call sign</th>
                <th className="py-2 pr-3">Team</th>
                <th className="py-2 pr-3">Mode</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3 text-right">Pts</th>
                <th className="py-2 pr-3 text-right">Out (s)</th>
                <th className="py-2 pr-3">Flag</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {view.players.map((player) => (
                <tr
                  key={player.playerId}
                  className="border-b border-hairline/60 last:border-0"
                >
                  <td className="py-2 pr-3">{player.callSign}</td>
                  <td className="py-2 pr-3">{player.role}</td>
                  <td className="py-2 pr-3">{player.mode}</td>
                  <td className="py-2 pr-3">{player.status}</td>
                  <td className="py-2 pr-3 text-right">{player.points}</td>
                  <td className="py-2 pr-3 text-right">
                    {player.outsideSeconds}
                  </td>
                  <td className="py-2 pr-3">
                    {player.flagged ? (
                      <span className="text-red-600" title={player.flagReason ?? ""}>
                        {player.flagReason}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="text-[11px] uppercase tracking-[0.14em] underline decoration-hairline underline-offset-4"
                        disabled={pending !== null}
                        onClick={() =>
                          setPending({
                            kind: "warn",
                            label: ACTION_COPY.warn,
                            detail: player.callSign,
                            playerIds: { playerId: player.playerId },
                          })
                        }
                      >
                        Warn
                      </button>
                      {player.role === "shadow" && (
                        <select
                          className="rounded border border-hairline bg-background px-2 py-1 text-[11px] uppercase tracking-[0.1em]"
                          value={player.mode}
                          disabled={pending !== null}
                          onChange={(event) =>
                            setPending({
                              kind: "mode",
                              label: ACTION_COPY.mode,
                              detail: `${player.callSign}: ${player.mode} → ${event.target.value}`,
                              playerIds: { playerId: player.playerId },
                              mode: event.target.value as PlayerMode,
                            })
                          }
                        >
                          <option value="spectator">Spectator</option>
                          <option value="hunter">Hunter</option>
                          <option value="helper">Helper</option>
                        </select>
                      )}
                      {player.status !== "removed" && (
                        <button
                          type="button"
                          className="text-[11px] uppercase tracking-[0.14em] text-red-600 underline decoration-red-300 underline-offset-4"
                          disabled={pending !== null}
                          onClick={() =>
                            setPending({
                              kind: "remove",
                              label: ACTION_COPY.remove,
                              detail: `${player.callSign} leaves the match. A removed Shadow gets no survival bonus.`,
                              playerIds: { playerId: player.playerId },
                            })
                          }
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Audit log ------------------------------------------------------ */}
      <section className="rounded-xl border border-hairline p-5">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Audit log
        </h2>
        {view.audit.length === 0 && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            Nothing has been done yet.
          </p>
        )}
        <ul className="mt-4 grid gap-3">
          {[...view.audit]
            .sort((a, b) => b.at - a.at)
            .map((entry) => (
              <li
                key={entry.id}
                className="border-b border-hairline pb-3 text-[13px] last:border-0"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <strong>{entry.actorName}</strong> ·{" "}
                    {entry.action.replace(/_/g, " ")}
                    {entry.targetLabel ? ` · ${entry.targetLabel}` : ""}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>
                </div>
                {entry.reason && (
                  <p className="mt-1 text-muted-foreground">{entry.reason}</p>
                )}
                {entry.detail && (
                  <p className="mt-1 text-muted-foreground">{entry.detail}</p>
                )}
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function Monitor() {
  const [params, setParams] = useSearchParams();
  const matchId = params.get("match");

  if (matchId) {
    return (
      <div className="min-h-screen bg-background px-4 pb-16 pt-10 text-foreground sm:px-6">
        <main className="mx-auto max-w-5xl">
          <Console
            matchId={matchId}
            onLeave={() => {
              void setParams({});
            }}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-10 text-foreground sm:px-6">
      <main className="mx-auto max-w-2xl">
        <header className="mb-10 text-center">
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Shadow Hunt · Invigilator
          </p>
          <h1 className="mt-3 font-display text-4xl tracking-tight">
            Match monitor
          </h1>
          <p className="mx-auto mt-2 max-w-md text-[13px] text-muted-foreground">
            Invigilators are named by the organiser, are not players and carry
            no score. Enter the invite code you were given.
          </p>
        </header>
        <InviteGate />
      </main>
    </div>
  );
}
