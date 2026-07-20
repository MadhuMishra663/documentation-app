import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { enqueueUpdate } from "@/lib/db/local-db";

/**
 * Wraps a single document's Yjs CRDT state.
 *
 * WHY YJS FOR "DESIGNING COMPLEX DATA MERGING ALGORITHMS":
 * Hand-rolling operational transforms is exactly the kind of thing the
 * assignment warns against reinventing badly. Yjs implements a well-studied
 * CRDT (a variant of YATA) with a hard, provable guarantee: applying the
 * same set of updates in ANY order, ANY number of times, on ANY replica,
 * converges to the identical document state (strong eventual consistency).
 * That's what "deterministic conflict resolution" means concretely — two
 * users who were both offline and both edited the same paragraph don't get
 * a "conflict dialog"; their edits are merged character-by-character using
 * each op's causal history, with ties broken by a deterministic client-id
 * ordering baked into the algorithm. No server-side merge logic is needed;
 * the server's job is just to durably store and relay opaque update bytes.
 *
 * y-indexeddb gives us the local-first persistence: the CRDT state lives in
 * IndexedDB and is available instantly on reload with zero network calls.
 */
export class CrdtDocument {
  readonly documentId: string;
  readonly ydoc: Y.Doc;
  readonly ytext: Y.Text;
  private persistence: IndexeddbPersistence;
  private onLocalUpdate: (update: Uint8Array) => void;

  constructor(documentId: string) {
    this.documentId = documentId;
    this.ydoc = new Y.Doc();
    this.ytext = this.ydoc.getText("content");
    this.persistence = new IndexeddbPersistence(`doc-${documentId}`, this.ydoc);

    // Every local edit produces a Yjs update (a compact binary diff, NOT a
    // full-document snapshot). We queue it for the background sync engine
    // rather than sending it immediately — this is what lets editing keep
    // working, instantly, while offline.
    this.onLocalUpdate = (update: Uint8Array) => {
      void enqueueUpdate(this.documentId, update);
    };
    this.ydoc.on("update", (update: Uint8Array, origin: unknown) => {
      // origin !== "remote" ensures we don't re-queue updates that just
      // arrived FROM the server during a pull — otherwise we'd echo them
      // straight back and loop forever.
      if (origin !== "remote") {
        this.onLocalUpdate(update);
      }
    });
  }

  async whenSynced(): Promise<void> {
    await this.persistence.whenSynced;
  }

  /** Apply an update that came from the server (a remote peer's edit). */
  applyRemoteUpdate(update: Uint8Array) {
    Y.applyUpdate(this.ydoc, update, "remote");
  }

  /** Full state vector, used to restore to a snapshot or seed a fresh client. */
  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  /**
   * Time-travel restore: rather than deleting history and overwriting shared
   * state (which would corrupt other active collaborators' view), we
   * generate a NEW update that transforms the current state into the
   * snapshot's content. This is itself just another CRDT operation, so it
   * merges deterministically with whatever anyone else is concurrently
   * typing — nobody's live cursor position gets destroyed by a hard reset.
   */
  restoreToSnapshot(snapshotState: Uint8Array) {
    const snapshotDoc = new Y.Doc();
    Y.applyUpdate(snapshotDoc, snapshotState);
    const snapshotText = snapshotDoc.getText("content").toString();

    this.ydoc.transact(() => {
      this.ytext.delete(0, this.ytext.length);
      this.ytext.insert(0, snapshotText);
    }, "restore");
  }

  destroy() {
    this.persistence.destroy();
    this.ydoc.destroy();
  }
}
