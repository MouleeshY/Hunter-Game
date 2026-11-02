import { useCallback, useEffect, useRef, useState } from "react";
import type { ComplaintTargets } from "../../server/complaints";
import type { FeedView } from "../../server/events";
import type { LobbyView } from "../../server/index";
import type { ConsoleView } from "../../server/console";
import type { MapView, PositionUploadResult } from "../../server/positionService";
import type {
  PlayerResult,
  PublicResult,
  PublicResultSummary,
  ResultTools,
} from "../../server/results";
import type { MatchConfig } from "../../rules/config";
import type { PlayerMode } from "../../rules/types";
import { REFRESH_INTERVALS } from "../../rules/config";
import {
  subscribeToMatchNudge,
  type BroadcastChannelLike,
  type RealtimeClientLike,
} from "../../lib/realtime";
import { getSupabaseClient, requireSupabaseClient } from "../supabase";

export type { ComplaintTargets } from "../../server/complaints";
export type { FeedView } from "../../server/events";
export type { LobbyView } from "../../server/index";
export type { ConsoleView } from "../../server/console";
export type { MapView, PositionUploadResult } from "../../server/positionService";
export type {
  PlayerResult,
  PublicResult,
  PublicResultRow,
  PublicResultSummary,
  ResultTools,
} from "../../server/results";

export interface ApiError extends Error {
  status?: number;
}

export interface ApiQuery<T> {
  data: T | undefined;
  loading: boolean;
  error: ApiError | null;
  refetch: () => Promise<void>;
}

export interface CreateRoomArgs {
  matchDurationMinutes: number;
  organiserLat: number;
  organiserLng: number;
  invigilatorNames: string[];
  defaultCaptureMode?: PlayerMode;
  proximityDetection?: boolean;
  title?: string;
  clubName?: string;
}

export interface JoinRoomArgs {
  roomCode: string;
  callSign: string;
  displayName: string;
  displayNameMode: "nickname" | "real";
}

export interface MatchIdArgs {
  matchId: string;
}

type ServiceReturn<T> = T extends (...args: infer _Args) => infer Result
  ? Awaited<Result>
  : never;
type CreateRoomResult = ServiceReturn<
  typeof import("../../server/index").createMatch
>;
type JoinRoomResult = ServiceReturn<
  typeof import("../../server/index").joinMatch
>;
type AcceptInviteResult = ServiceReturn<
  typeof import("../../server/index").claimInvite
>;
type ScanResult = ServiceReturn<
  typeof import("../../server/tagScan").submitTagScan
>;
type CaptureModeResult = ServiceReturn<
  typeof import("../../server/tagScan").chooseCaptureMode
>;
type PublishResult = ServiceReturn<
  typeof import("../../server/results").setResultPublished
>;
type UploadResult = PositionUploadResult;
type ComplaintResult = Awaited<
  ReturnType<typeof import("../../server/complaints").fileComplaint>
>;
type ConsoleActionResult = ServiceReturn<
  typeof import("../../server/console").forceTag
>;

interface MutationArgs {
  createRoom: CreateRoomArgs;
  joinRoom: JoinRoomArgs;
  acknowledgeBriefing: MatchIdArgs;
  lockRoster: MatchIdArgs & { locked: boolean };
  startRoom: MatchIdArgs & { force?: boolean };
  beginHeadStart: MatchIdArgs & { force?: boolean };
  extendSetup: MatchIdArgs;
  rerollCentre: MatchIdArgs;
  endRoom: MatchIdArgs & { reason?: string };
  abortRoom: MatchIdArgs & { reason: string };
  pauseRoom: MatchIdArgs & { reason?: string };
  resumeRoom: MatchIdArgs & { reason?: string };
  acceptInvite: { inviteCode: string };
  uploadPosition: MatchIdArgs & {
    lat: number;
    lng: number;
    accuracyMetres?: number;
  };
  submitScan: MatchIdArgs & {
    scannedToken: string;
    scannerLat: number;
    scannerLng: number;
    scannerAccuracyMetres?: number;
    assistedByPlayerId?: string;
  };
  chooseCaptureMode: MatchIdArgs & { mode: PlayerMode };
  sendHelp: MatchIdArgs & {
    lat?: number;
    lng?: number;
    accuracyMetres?: number;
  };
  fileComplaint: MatchIdArgs & {
    accusedId: string;
    note?: string;
    incidentAtMs?: number;
  };
  dismissComplaint: MatchIdArgs & { complaintId: string; reason: string };
  forceTag: MatchIdArgs & {
    hunterId: string;
    shadowId: string;
    reason: string;
  };
  warnPlayer: MatchIdArgs & { playerId: string; reason: string };
  removePlayer: MatchIdArgs & { playerId: string; reason: string };
  changeMode: MatchIdArgs & {
    playerId: string;
    mode: PlayerMode;
    reason: string;
  };
  pauseConsole: MatchIdArgs & { reason?: string };
  resumeConsole: MatchIdArgs & { reason?: string };
  publishResult: MatchIdArgs & { publish: boolean };
}

interface MutationResults {
  createRoom: CreateRoomResult;
  joinRoom: JoinRoomResult;
  acknowledgeBriefing: void;
  lockRoster: string;
  startRoom: ServiceReturn<typeof import("../../server/index").startMatch>;
  beginHeadStart: ServiceReturn<typeof import("../../server/setup").beginHeadStart>;
  extendSetup: ServiceReturn<typeof import("../../server/setup").extendSetup>;
  rerollCentre: ServiceReturn<typeof import("../../server/index").rerollCentre>;
  endRoom: ServiceReturn<typeof import("../../server/console").endMatchEarly>;
  abortRoom: ServiceReturn<typeof import("../../server/console").abortMatch>;
  pauseRoom: ServiceReturn<typeof import("../../server/console").pauseMatch>;
  resumeRoom: ServiceReturn<typeof import("../../server/console").resumeMatch>;
  acceptInvite: AcceptInviteResult;
  uploadPosition: UploadResult;
  submitScan: ScanResult;
  chooseCaptureMode: CaptureModeResult;
  sendHelp: ServiceReturn<typeof import("../../server/events").raiseHelpAlert>;
  fileComplaint: Pick<ComplaintResult, "id" | "responseDueAt">;
  dismissComplaint: { ok: true };
  forceTag: ConsoleActionResult;
  warnPlayer: { ok: true };
  removePlayer: { ok: true };
  changeMode: { ok: true };
  pauseConsole: ServiceReturn<typeof import("../../server/console").pauseMatch>;
  resumeConsole: ServiceReturn<typeof import("../../server/console").resumeMatch>;
  publishResult: PublishResult;
}

export interface ApiClient {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

let apiClient: ApiClient = { fetch: (input, init) => fetch(input, init) };

export function setApiClientForTests(next: ApiClient | null): void {
  apiClient = next ?? { fetch: (input, init) => fetch(input, init) };
}

function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}

function redirectToSignIn(): void {
  if (typeof window === "undefined") return;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/auth?returnTo=${encodeURIComponent(returnTo)}`);
}

async function request<T>(
  path: string,
  body: object,
  authMode: "required" | "optional" | "none" = "required",
): Promise<T> {
  const supabase =
    authMode === "required"
      ? requireSupabaseClient()
      : authMode === "optional"
        ? getSupabaseClient()
        : null;
  const sessionResult = supabase ? await supabase.auth.getSession() : null;
  if (sessionResult?.error) throw sessionResult.error;
  let token = sessionResult?.data.session?.access_token ?? null;

  const send = async (accessToken: string | null) =>
    await apiClient.fetch(apiUrl(path), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });

  let response = await send(token);
  if (response.status === 401 && supabase) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) {
      if (authMode === "required") redirectToSignIn();
      throw new ApiErrorImpl("Your session expired. Sign in again.", 401);
    }
    token = refreshed.data.session.access_token;
    response = await send(token);
    if (response.status === 401) {
      redirectToSignIn();
      throw new ApiErrorImpl("Your session expired. Sign in again.", 401);
    }
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiErrorImpl("The API returned an invalid response.", response.status);
  }
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `API request failed (${response.status}).`;
    throw new ApiErrorImpl(message, response.status);
  }
  return payload as T;
}

class ApiErrorImpl extends Error implements ApiError {
  readonly status: number;

  constructor(
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function matchEnded<T extends { status?: string; ended?: boolean }>(
  value: T,
): boolean {
  return value.status === "ended" || value.ended === true;
}

function realtimeAdapter(): RealtimeClientLike | null {
  const client = getSupabaseClient();
  if (client === null) return null;
  return {
    channel: (
      name: string,
      _options?: Record<string, unknown>,
    ): BroadcastChannelLike => {
      void _options;
      const channel = client.channel(name, {
        config: { broadcast: { self: false } },
      });
      const adapted: BroadcastChannelLike = {
        on: (_type, filter, callback) => {
          channel.on("broadcast", { event: filter.event }, (message) => {
            callback({ event: filter.event, payload: message.payload });
          });
          return adapted;
        },
        subscribe: () => channel.subscribe(),
        unsubscribe: () => channel.unsubscribe(),
      };
      return adapted;
    },
  };
}

const nudgeListeners = new Map<string, Set<() => void>>();
const nudgeUnsubscribers = new Map<string, () => void>();
let sharedRealtimeClient: RealtimeClientLike | null | undefined;

function subscribeToNudges(matchId: string, listener: () => void): () => void {
  const listeners = nudgeListeners.get(matchId) ?? new Set<() => void>();
  listeners.add(listener);
  nudgeListeners.set(matchId, listeners);
  if (!nudgeUnsubscribers.has(matchId)) {
    sharedRealtimeClient ??= realtimeAdapter();
    if (sharedRealtimeClient !== null) {
      nudgeUnsubscribers.set(
        matchId,
        subscribeToMatchNudge(sharedRealtimeClient, matchId, () => {
          for (const notify of nudgeListeners.get(matchId) ?? []) notify();
        }),
      );
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      nudgeListeners.delete(matchId);
      nudgeUnsubscribers.get(matchId)?.();
      nudgeUnsubscribers.delete(matchId);
    }
  };
}

function useApiQuery<T>(
  path: string,
  args: object,
  options: {
    enabled?: boolean;
    pollMs?: number;
    matchId?: string | null;
    stopWhen?: (data: T) => boolean;
    authMode?: "required" | "optional" | "none";
  } = {},
): ApiQuery<T> {
  const {
    enabled = true,
    pollMs,
    matchId = null,
    stopWhen,
    authMode = "required",
  } = options;
  const encodedArgs = JSON.stringify(args);
  const argsRef = useRef(args);
  const dataRef = useRef<T | undefined>(undefined);
  const [dataState, setDataState] = useState<{
    key: string;
    value: T;
  } | null>(null);
  const [loadingState, setLoadingState] = useState<{
    key: string;
    value: boolean;
  } | null>(null);
  const [errorState, setErrorState] = useState<{
    key: string;
    value: ApiError;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const stopped = useRef(false);
  const data = dataState?.key === encodedArgs ? dataState.value : undefined;
  const loading =
    enabled &&
    (loadingState?.key === encodedArgs ? loadingState.value : true);
  const error =
    errorState?.key === encodedArgs ? errorState.value : null;

  const refetch = useCallback(async () => {
    if (!enabled) return;
    setLoadingState({ key: encodedArgs, value: dataRef.current === undefined });
    try {
      const next = await request<T>(path, argsRef.current, authMode);
      dataRef.current = next;
      setDataState({ key: encodedArgs, value: next });
      setErrorState(null);
      stopped.current = stopWhen?.(next) ?? false;
    } catch (cause) {
      const nextError =
        cause instanceof ApiErrorImpl
          ? cause
          : cause instanceof Error
            ? new ApiErrorImpl(cause.message, 0)
            : new ApiErrorImpl("The request failed.", 0);
      setErrorState({ key: encodedArgs, value: nextError });
      throw nextError;
    } finally {
      setLoadingState({ key: encodedArgs, value: false });
    }
  }, [authMode, enabled, encodedArgs, path, stopWhen]);

  useEffect(() => {
    argsRef.current = args;
  }, [encodedArgs, args]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!enabled) {
      stopped.current = false;
      return;
    }
    void refetch().catch(() => undefined);
  }, [encodedArgs, enabled, refreshKey, refetch]);

  useEffect(() => {
    if (!enabled || pollMs === undefined) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let cancelled = false;

    const schedule = () => {
      if (cancelled || document.visibilityState !== "visible" || stopped.current) {
        return;
      }
      const delay = failures === 0
        ? pollMs
        : Math.min(pollMs * 2 ** failures, 15_000);
      timer = setTimeout(async () => {
        try {
          await refetch();
          failures = 0;
        } catch {
          failures += 1;
        }
        schedule();
      }, delay);
    };

    const refreshVisible = () => {
      if (document.visibilityState !== "visible") {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        return;
      }
      if (timer !== null) clearTimeout(timer);
      timer = null;
      void refetch()
        .then(() => {
          failures = 0;
        })
        .catch(() => {
          failures += 1;
        })
        .finally(schedule);
    };
    schedule();
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("focus", refreshVisible);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("focus", refreshVisible);
    };
  }, [enabled, pollMs, refetch]);

  useEffect(() => {
    if (!enabled || matchId === null) return;
    return subscribeToNudges(matchId, () =>
      setRefreshKey((key) => key + 1),
    );
  }, [enabled, matchId]);

  return { data, loading, error, refetch };
}

export function useLobby(roomCode: string | null): ApiQuery<LobbyView | null> {
  return useApiQuery(
    "/api/rooms/lobby",
    { roomCode: roomCode?.toUpperCase() ?? "" },
    {
      enabled: roomCode !== null,
      pollMs: REFRESH_INTERVALS.lobbyMs,
      stopWhen: (data) => data !== null && matchEnded(data),
    },
  );
}

export function useMapView(matchId: string | null): ApiQuery<MapView | null> {
  return useApiQuery(
    "/api/map/view",
    { matchId },
    {
      enabled: matchId !== null,
      pollMs: REFRESH_INTERVALS.mapMs,
      matchId,
      stopWhen: (data) => data !== null && matchEnded(data),
    },
  );
}

export function useMatchView(matchId: string | null): ApiQuery<MapView | null> {
  return useApiQuery(
    "/api/map/view",
    { matchId },
    {
      enabled: matchId !== null,
      pollMs: REFRESH_INTERVALS.matchMs,
      matchId,
      stopWhen: (data) => data !== null && matchEnded(data),
    },
  );
}

export function useFeed(matchId: string | null): ApiQuery<FeedView> {
  return useApiQuery(
    "/api/events/feed",
    { matchId },
    {
      enabled: matchId !== null,
      pollMs: REFRESH_INTERVALS.matchMs,
      matchId,
      stopWhen: (data) => matchEnded(data),
    },
  );
}

export function useComplaintTargets(
  matchId: string | null,
): ApiQuery<ComplaintTargets> {
  return useApiQuery(
    "/api/complaints/complaintTargets",
    { matchId },
    {
      enabled: matchId !== null,
      pollMs: REFRESH_INTERVALS.matchMs,
      matchId,
    },
  );
}

export function useConsoleView(matchId: string | null): ApiQuery<ConsoleView | null> {
  return useApiQuery(
    "/api/monitor/view",
    { matchId },
    {
      enabled: matchId !== null,
      pollMs: REFRESH_INTERVALS.matchMs,
      matchId,
      stopWhen: (data) => data !== null && data.status === "ended",
    },
  );
}

export function usePublicResult(slug: string): ApiQuery<PublicResult | null> {
  return useApiQuery(
    "/api/results/public",
    { slug },
    { enabled: Boolean(slug), authMode: "none" },
  );
}

export function useResultTools(slug: string): ApiQuery<ResultTools | null> {
  return useApiQuery(
    "/api/results/tools",
    { slug },
    { enabled: Boolean(slug), authMode: "optional" },
  );
}

export function usePublicResults(
  club: string | null,
): ApiQuery<PublicResultSummary[]> {
  return useApiQuery(
    "/api/results/list",
    club ? { club } : {},
    { authMode: "none" },
  );
}

export function usePlayerResult(matchId: string | null): ApiQuery<PlayerResult | null> {
  return useApiQuery(
    "/api/results/mine",
    { matchId },
    { enabled: matchId !== null, matchId },
  );
}

export function useManagedResult(matchId: string | null): ApiQuery<ResultTools | null> {
  return useApiQuery(
    "/api/results/manage",
    { matchId },
    {
      enabled: matchId !== null,
      matchId,
      pollMs: 2_000,
      stopWhen: (result) => result !== null && result.canPublish,
    },
  );
}

export function useInvitePreview(
  inviteCode: string | null,
): ApiQuery<Awaited<ReturnType<typeof import("../../server/index").previewInvite>> | null> {
  return useApiQuery(
    "/api/rooms/invitePreview",
    { inviteCode },
    { enabled: inviteCode !== null },
  );
}

const mutationPaths = {
  createRoom: "/api/rooms/createRoom",
  joinRoom: "/api/rooms/joinRoom",
  acknowledgeBriefing: "/api/rooms/acknowledgeBriefing",
  lockRoster: "/api/rooms/lockRoster",
  startRoom: "/api/rooms/startRoom",
  beginHeadStart: "/api/rooms/beginHeadStartRoom",
  extendSetup: "/api/rooms/extendSetupRoom",
  rerollCentre: "/api/rooms/rerollCentreHandler",
  endRoom: "/api/rooms/endRoom",
  abortRoom: "/api/rooms/abortRoom",
  pauseRoom: "/api/rooms/pauseRoom",
  resumeRoom: "/api/rooms/resumeRoom",
  acceptInvite: "/api/rooms/acceptInvite",
  uploadPosition: "/api/matches/uploadPosition",
  submitScan: "/api/matches/submitTagScan",
  chooseCaptureMode: "/api/matches/chooseCaptureMode",
  sendHelp: "/api/events/help",
  fileComplaint: "/api/complaints/file",
  dismissComplaint: "/api/monitor/dismiss",
  forceTag: "/api/monitor/force",
  warnPlayer: "/api/monitor/warn",
  removePlayer: "/api/monitor/remove",
  changeMode: "/api/monitor/changeMode",
  pauseConsole: "/api/monitor/pause",
  resumeConsole: "/api/monitor/resume",
  publishResult: "/api/results/publish",
} as const;

export function useMutation<K extends keyof typeof mutationPaths>(
  key: K,
): (args: MutationArgs[K]) => Promise<MutationResults[K]> {
  return useCallback(
    (args: MutationArgs[K]) =>
      request<MutationResults[K]>(mutationPaths[key], args),
    [key],
  );
}

export function useEnsureProfile(): () => Promise<{
  id: string;
  authId: string;
  name: string | null;
  email: string | null;
}> {
  return useCallback(() => request("/api/users/ensure", {}), []);
}

export function useCreateRoom(): ReturnType<typeof useMutation<"createRoom">> {
  return useMutation("createRoom");
}

export function useJoinRoom(): ReturnType<typeof useMutation<"joinRoom">> {
  return useMutation("joinRoom");
}

export function useAcknowledgeBriefing(): ReturnType<
  typeof useMutation<"acknowledgeBriefing">
> {
  return useMutation("acknowledgeBriefing");
}

export function useMatchConfig(data: MapView | undefined): MatchConfig | undefined {
  return data?.config;
}
