import Dexie, { type Table } from "dexie";

/**
 * Local-first storage layer.
 *
 * IMPORTANT: this IndexedDB database — not the Postgres server — is the
 * primary source of truth for the client. The UI reads/writes here
 * synchronously (well, async but never network-blocking) via Yjs +
 * y-indexeddb. The tables below are *additional* bookkeeping on top of that:
 * the outbound sync queue, and metadata the sync engine needs to decide what
 * to push/pull and in what order.
 *
 * Nothing in this file ever awaits a network call. That's the whole point of
 * "local-first": open/edit/close must work with zero network requests
 * blocking the UI, per the assignment's hard requirement.
 */

export interface QueuedUpdate {
  id?: number; // auto-increment
  documentId: string;
  clientMsgId: string; // uuid, used server-side for idempotent dedupe
  update: Uint8Array; // raw Yjs update bytes
  createdAt: number;
  attempts: number;
  lastAttemptAt: number | null;
  lastError: string | null;
}

export interface DocumentMeta {
  documentId: string;
  title: string;
  role: "OWNER" | "EDITOR" | "VIEWER";
  lastSyncedAt: number | null;
  lastKnownServerCursor: string | null; // createdAt cursor for incremental pull
  dirty: boolean; // has local unsynced changes
}

class LocalDB extends Dexie {
  queuedUpdates!: Table<QueuedUpdate, number>;
  documentMeta!: Table<DocumentMeta, string>;

  constructor() {
    super("collab-editor-local");
    this.version(1).stores({
      // ++id = autoincrement primary key; index documentId+createdAt so the
      // sync engine can drain a single document's queue in FIFO order
      // without a full table scan.
      queuedUpdates: "++id, documentId, [documentId+createdAt], attempts",
      documentMeta: "documentId, dirty",
    });
  }
}

export const localDB = new LocalDB();

/** Enqueue a local edit for background sync. Called on every Yjs update. */
export async function enqueueUpdate(documentId: string, update: Uint8Array) {
  const clientMsgId = crypto.randomUUID();
  await localDB.queuedUpdates.add({
    documentId,
    clientMsgId,
    update,
    createdAt: Date.now(),
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
  });
  await localDB.documentMeta.update(documentId, { dirty: true });
}

/** Pull the oldest N queued updates for a document, oldest-first (FIFO). */
export async function getPendingUpdates(documentId: string, limit = 25) {
  return localDB.queuedUpdates
    .where("[documentId+createdAt]")
    .between([documentId, Dexie.minKey], [documentId, Dexie.maxKey])
    .limit(limit)
    .toArray();
}

export async function removeQueuedUpdates(ids: number[]) {
  await localDB.queuedUpdates.bulkDelete(ids);
}

export async function markAttemptFailed(id: number, error: string) {
  await localDB.queuedUpdates.update(id, {
    attempts: (await localDB.queuedUpdates.get(id))!.attempts + 1,
    lastAttemptAt: Date.now(),
    lastError: error,
  });
}
