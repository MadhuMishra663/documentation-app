import { describe, it, expect } from "vitest";
import * as Y from "yjs";

/**
 * This is the test that matters most for the assignment's core claim:
 * "deterministic conflict resolution merging without data loss."
 *
 * We simulate two clients that started from the same synced state, then
 * went offline and both edited concurrently, then reconnected in different
 * orders. The assertion is that regardless of the order updates are applied
 * in, every replica converges to the exact same final string, and neither
 * user's edit is silently dropped.
 */
describe("CRDT conflict resolution", () => {
  it("converges identically regardless of update application order", () => {
    const base = new Y.Doc();
    base.getText("content").insert(0, "The quick fox jumps.");
    const baseState = Y.encodeStateAsUpdate(base);

    // Client A goes offline, inserts "brown " before "fox".
    const clientA = new Y.Doc();
    Y.applyUpdate(clientA, baseState);
    clientA.getText("content").insert(10, "brown ");
    const updateA = Y.encodeStateAsUpdate(clientA, Y.encodeStateVector(base));

    // Client B goes offline (never saw A's edit), appends " Every day." at the end.
    const clientB = new Y.Doc();
    Y.applyUpdate(clientB, baseState);
    clientB.getText("content").insert(clientB.getText("content").length, " Every day.");
    const updateB = Y.encodeStateAsUpdate(clientB, Y.encodeStateVector(base));

    // Replica 1: applies A then B.
    const replica1 = new Y.Doc();
    Y.applyUpdate(replica1, baseState);
    Y.applyUpdate(replica1, updateA);
    Y.applyUpdate(replica1, updateB);

    // Replica 2: applies B then A (reversed order).
    const replica2 = new Y.Doc();
    Y.applyUpdate(replica2, baseState);
    Y.applyUpdate(replica2, updateB);
    Y.applyUpdate(replica2, updateA);

    const result1 = replica1.getText("content").toString();
    const result2 = replica2.getText("content").toString();

    expect(result1).toBe(result2); // order-independence: the core CRDT guarantee
    expect(result1).toContain("brown fox"); // A's edit survived
    expect(result1).toContain("Every day."); // B's edit survived
  });

  it("re-applying an already-applied update is a safe no-op (idempotency)", () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "hello");
    const update = Y.encodeStateAsUpdate(doc);

    const replica = new Y.Doc();
    Y.applyUpdate(replica, update);
    Y.applyUpdate(replica, update); // duplicate delivery, e.g. a retried sync request
    Y.applyUpdate(replica, update);

    expect(replica.getText("content").toString()).toBe("hello");
  });
});
