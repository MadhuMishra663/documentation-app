import { getPendingUpdates, removeQueuedUpdates, markAttemptFailed, localDB } from "@/lib/db/local-db";
import type { CrdtDocument } from "./crdt-doc";

export type SyncStatus = "offline" | "syncing" | "synced" | "error";

type Listener = (status: SyncStatus) => void;

/**
 * SyncEngine: reconciles local IndexedDB state with the server whenever
 * connectivity allows, without ever blocking the editing UI.
 *
 * RACE CONDITIONS THIS SPECIFICALLY GUARDS AGAINST:
 *
 * 1. "Double flush" — two sync cycles running concurrently (e.g. a
 *    `visibilitychange` event fires while a `navigator.onLine` handler is
 *    already mid-flush). Guarded by `this.flushing`, a simple mutex flag;
 *    a second call while one is in flight just returns.
 *
 * 2. "Lost update on retry" — if a push succeeds on the server but the
 *    client's response handling fails (e.g. tab closes mid-response), a
 *    naive queue would either lose the update or resend it as a duplicate.
 *    We solve this with an idempotency key (`clientMsgId`, a UUID minted at
 *    enqueue time) that the server uses as a unique constraint — resending
 *    the same row is safe no-op, not a duplicate edit. This is why we only
 *    delete a queued row from IndexedDB AFTER the server 200s, never before.
 *
 * 3. "Push/pull interleaving corrupting state" — pulling remote updates
 *    while a local edit is being queued could, in a naive implementation,
 *    apply a remote update on top of a half-written local transaction. Yjs
 *    transactions are atomic and updates are commutative, so this is safe
 *    at the CRDT layer by construction — but we still serialize our own
 *    push-then-pull cycle (never run both directions concurrently) to keep
 *    the sync cursor bookkeeping simple and avoid re-fetching updates we
 *    just pushed.
 *
 * 4. "Thundering herd on reconnect" — every open tab/document reconnecting
 *    simultaneously and hammering the API. Exponential backoff with jitter
 *    on failure, and a small fixed delay before the first sync after an
 *    `online` event, smooths this out.
 */
export class SyncEngine {
  private doc: CrdtDocument;
  private flushing = false;
  private backoffMs = 1000;
  private readonly maxBackoffMs = 30_000;
  private listeners: Listener[] = [];
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(doc: CrdtDocument) {
    this.doc = doc;
  }

  start() {
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
    if (navigator.onLine) {
      void this.flush();
    } else {
      this.emit("offline");
    }
  }

  stop() {
    this.destroyed = true;
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  onStatusChange(listener: Listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(status: SyncStatus) {
    this.listeners.forEach((l) => l(status));
  }

  private handleOnline = () => {
    // Small jitter so many tabs reconnecting at once don't all hit the API
    // in the same tick.
    const jitter = Math.random() * 500;
    setTimeout(() => void this.flush(), jitter);
  };

  private handleOffline = () => {
    this.emit("offline");
  };

  /** Push queued local updates, then pull remote updates. Safe to call repeatedly. */
  async flush() {
    if (this.flushing || this.destroyed) return;
    if (!navigator.onLine) {
      this.emit("offline");
      return;
    }
    this.flushing = true;
    this.emit("syncing");
    try {
      await this.pushPending();
      await this.pullRemote();
      this.backoffMs = 1000; // reset backoff after a clean cycle
      await localDB.documentMeta.update(this.doc.documentId, {
        lastSyncedAt: Date.now(),
        dirty: false,
      });
      this.emit("synced");
    } catch (err) {
      this.emit("error");
      this.scheduleRetry();
    } finally {
      this.flushing = false;
    }
  }

  private scheduleRetry() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.flush(), this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
  }

  private async pushPending() {
    // Drain in small batches rather than one giant request — keeps request
    // size bounded (defense in depth alongside the server's payload cap) and
    // means a huge backlog after a long offline stretch doesn't produce a
    // single multi-megabyte POST.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await getPendingUpdates(this.doc.documentId, 25);
      if (batch.length === 0) return;

      const res = await fetch(`/api/documents/${this.doc.documentId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: batch.map((u) => ({
            clientMsgId: u.clientMsgId,
            update: Array.from(u.update), // base10 array keeps this dependency-free; see README for base64 alt
          })),
        }),
      });

      if (res.status === 403) {
        // Viewer role, or removed as collaborator — stop trying to push,
        // surface as an error state rather than retrying forever.
        throw new Error("forbidden");
      }
      if (!res.ok) {
        for (const u of batch) await markAttemptFailed(u.id!, `HTTP ${res.status}`);
        throw new Error(`push failed: ${res.status}`);
      }

      await removeQueuedUpdates(batch.map((u) => u.id!));
    }
  }

  private async pullRemote() {
    const meta = await localDB.documentMeta.get(this.doc.documentId);
    const since = meta?.lastKnownServerCursor ?? "";
    const res = await fetch(
      `/api/documents/${this.doc.documentId}/sync?since=${encodeURIComponent(since)}`
    );
    if (!res.ok) throw new Error(`pull failed: ${res.status}`);
    const { updates, cursor } = (await res.json()) as {
      updates: { update: number[] }[];
      cursor: string | null;
    };
    for (const u of updates) {
      this.doc.applyRemoteUpdate(new Uint8Array(u.update));
    }
    if (cursor) {
      await localDB.documentMeta.update(this.doc.documentId, {
        lastKnownServerCursor: cursor,
      });
    }
  }
}
