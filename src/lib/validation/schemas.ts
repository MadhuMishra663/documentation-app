import { z } from "zod";

/**
 * Server-side payload validation.
 *
 * "How do you prevent a malicious actor from sending a massive, malformed
 * synchronization payload that OOMs your server?" — layered defense:
 *
 *  1. Reverse proxy / platform body-size limit (Vercel: 4.5MB by default on
 *     serverless functions) — outside this codebase, but the real first
 *     line of defense; document it in your deployment config.
 *  2. MAX_SYNC_PAYLOAD_BYTES env var, checked BEFORE JSON.parse in the route
 *     handler (see api/documents/[id]/sync/route.ts) by reading
 *     Content-Length / streaming a bounded reader — never parse an unbounded
 *     body into memory first.
 *  3. Per-update size cap (MAX_UPDATE_BYTES below) — a single Yjs update
 *     bigger than this is almost certainly not a legitimate incremental
 *     edit (a real keystroke-level diff is bytes to low-KB) and is rejected.
 *  4. Batch size cap (MAX_UPDATES_PER_REQUEST) — bounds worst-case per-request
 *     work even if every individual update passes size checks.
 *  5. Zod schema validation on shape/types BEFORE touching the bytes at all,
 *     so malformed JSON (wrong types, missing fields, extra nesting) is
 *     rejected with 400 cheaply instead of reaching business logic.
 */

export const MAX_UPDATE_BYTES = 500_000; // ~500KB per single CRDT update
export const MAX_UPDATES_PER_REQUEST = 25;

export const syncUpdateSchema = z.object({
  clientMsgId: z.string().uuid(),
  update: z
    .array(z.number().int().min(0).max(255))
    .max(MAX_UPDATE_BYTES, { message: "update exceeds MAX_UPDATE_BYTES" }),
});

export const syncPushSchema = z.object({
  updates: z.array(syncUpdateSchema).max(MAX_UPDATES_PER_REQUEST),
});

export const createDocumentSchema = z.object({
  title: z.string().min(1).max(200),
});

export const inviteCollaboratorSchema = z.object({
  email: z.string().email(),
  role: z.enum(["EDITOR", "VIEWER"]), // OWNER is not grantable via invite
});

export const saveVersionSchema = z.object({
  label: z.string().min(1).max(120).optional(),
});
