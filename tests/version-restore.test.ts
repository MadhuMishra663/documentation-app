import { describe, it, expect } from "vitest";
import * as Y from "yjs";

/**
 * Verifies the version-restore strategy used in
 * api/documents/[id]/versions/[versionId]/restore/route.ts: restoring to an
 * old snapshot is applied as a normal CRDT update (a scripted delete+insert
 * transaction), not a destructive reset — so a collaborator who kept typing
 * during the restore doesn't lose their concurrent edit.
 */
describe("version restore", () => {
  it("does not destroy a concurrent collaborator's in-flight edit", () => {
    const shared = new Y.Doc();
    shared.getText("content").insert(0, "Draft one.");
    const v1State = Y.encodeStateAsUpdate(shared); // this is our "saved version"

    shared.getText("content").insert(shared.getText("content").length, " Draft two additions.");

    // Collaborator B is concurrently typing on their own replica, unaware a
    // restore is about to happen.
    const collaboratorB = new Y.Doc();
    Y.applyUpdate(collaboratorB, Y.encodeStateAsUpdate(shared));
    collaboratorB.getText("content").insert(0, "URGENT: ");
    const bEdit = Y.encodeStateAsUpdate(collaboratorB, Y.encodeStateVector(shared));

    // Server performs the restore: transform `shared` to look like v1's content.
    const v1Doc = new Y.Doc();
    Y.applyUpdate(v1Doc, v1State);
    const v1Text = v1Doc.getText("content").toString();

    const beforeRestore = Y.encodeStateVector(shared);
    shared.transact(() => {
      const t = shared.getText("content");
      t.delete(0, t.length);
      t.insert(0, v1Text);
    }, "restore");
    const restoreDiff = Y.encodeStateAsUpdate(shared, beforeRestore);

    // Now merge collaborator B's concurrent edit with the restore diff, in
    // both orders, on a fresh replica each time.
    const merged1 = new Y.Doc();
    Y.applyUpdate(merged1, v1State);
    Y.applyUpdate(merged1, restoreDiff);
    Y.applyUpdate(merged1, bEdit);

    const merged2 = new Y.Doc();
    Y.applyUpdate(merged2, v1State);
    Y.applyUpdate(merged2, bEdit);
    Y.applyUpdate(merged2, restoreDiff);

    // Both orders converge, and B's "URGENT: " prefix is not silently lost.
    expect(merged1.getText("content").toString()).toBe(merged2.getText("content").toString());
    expect(merged1.getText("content").toString()).toContain("URGENT:");
  });
});
