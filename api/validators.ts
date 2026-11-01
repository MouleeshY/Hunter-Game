/**
 * Input validation for the HTTP API.
 *
 * One schema per client call, mirroring the Convex `args` of the matching
 * function in `src/convex/*.ts` field for field, so both backends accept the
 * same payload and refuse the same one.
 *
 * The only deliberate difference: ids. Convex ids are opaque document ids
 * (`v.id("matches")`), while Postgres uses uuids, so an id field here is a
 * uuid. The service underneath takes a plain string either way.
 */
import { z } from "zod";

const id = z.uuid();

const playerMode = z.enum(["spectator", "hunter", "helper"]);
const displayNameMode = z.enum(["nickname", "real"]);

// ---- rooms -----------------------------------------------------------------

export const createRoomArgs = z.object({
  matchDurationMinutes: z.number(),
  organiserLat: z.number(),
  organiserLng: z.number(),
  invigilatorNames: z.array(z.string()),
  defaultCaptureMode: playerMode.optional(),
  proximityDetection: z.boolean().optional(),
  title: z.string().optional(),
  clubName: z.string().optional(),
});

export const matchIdArgs = z.object({ matchId: id });

export const joinRoomArgs = z.object({
  roomCode: z.string(),
  callSign: z.string(),
  displayName: z.string(),
  displayNameMode,
});

export const roomCodeArgs = z.object({ roomCode: z.string() });

export const lockRosterArgs = z.object({ matchId: id, locked: z.boolean() });

export const forceArgs = z.object({ matchId: id, force: z.boolean().optional() });

export const reasonOptionalArgs = z.object({
  matchId: id,
  reason: z.string().optional(),
});

export const reasonRequiredArgs = z.object({ matchId: id, reason: z.string() });

export const inviteCodeArgs = z.object({ inviteCode: z.string() });

// ---- matches ---------------------------------------------------------------

export const uploadPositionArgs = z.object({
  matchId: id,
  lat: z.number(),
  lng: z.number(),
  accuracyMetres: z.number().optional(),
});

export const tagScanArgs = z.object({
  matchId: id,
  scannedToken: z.string(),
  scannerLat: z.number(),
  scannerLng: z.number(),
  scannerAccuracyMetres: z.number().optional(),
  assistedByPlayerId: id.optional(),
});

export const captureModeArgs = z.object({
  matchId: id,
  mode: playerMode,
});

// ---- complaints ------------------------------------------------------------

export const fileComplaintArgs = z.object({
  matchId: id,
  accusedId: id,
  note: z.string().optional(),
  incidentAtMs: z.number().optional(),
});

// ---- monitor / console -----------------------------------------------------

export const dismissComplaintArgs = z.object({
  matchId: id,
  complaintId: id,
  reason: z.string(),
});

export const forceTagArgs = z.object({
  matchId: id,
  hunterId: id,
  shadowId: id,
  reason: z.string(),
});

export const playerActionArgs = z.object({
  matchId: id,
  playerId: id,
  reason: z.string(),
});

export const changeModeArgs = z.object({
  matchId: id,
  playerId: id,
  mode: playerMode,
  reason: z.string(),
});

// ---- results ---------------------------------------------------------------

export const slugArgs = z.object({ slug: z.string() });
export const listResultsArgs = z.object({ club: z.string().optional() });
export const publishArgs = z.object({ matchId: id, publish: z.boolean() });

// ---- events ----------------------------------------------------------------

export const helpArgs = z.object({
  matchId: id,
  lat: z.number().optional(),
  lng: z.number().optional(),
  accuracyMetres: z.number().optional(),
});

export const noArgs = z.object({}).strict();
