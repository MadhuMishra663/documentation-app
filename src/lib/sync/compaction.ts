import * as Y from "yjs";
import { prisma } from "@/lib/db/prisma";

/**
 * "How do you handle document state size over time?"
 *
 * The DocumentUpdate log grows forever if left alone — that's fine for a
 * while (updates are small, and the log doubles as edit history) but it's
 * unbounded, which means: (a) a client that's been offline for months
 * replays a huge log on reconnect, and (b) storage cost grows linearly
 * with edit count rather than document size.
 *
 * Compaction: once a document's log crosses COMPACTION_THRESHOLD_BYTES since
 * its last compaction, we replay the full log into a single Y.Doc, take an
 * auto-snapshot of that merged state, and DELETE the log rows older than
 * the snapshot. Clients that pull after this point get the snapshot instead
 * of the full history. Named ("manual") version-history snapshots are never
 * deleted by compaction — only the auto/replay log is pruned, so time-travel
 * to a user-saved checkpoint is unaffected.
 *
 * This runs fire-and-forget after a push, outside the request/response
 * cycle, so it never adds latency to the user's save.
 */
const COMPACTION_THRESHOLD_BYTES = 5_000_000; // 5MB of accumulated updates

export async function maybeCompact(documentId: string) {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { logSizeBytes: true },
  });
  if (!doc || doc.logSizeBytes < COMPACTION_THRESHOLD_BYTES) return;

  await compactDocument(documentId);
}

export async function compactDocument(documentId: string) {
  const updates = await prisma.documentUpdate.findMany({
    where: { documentId },
    orderBy: { createdAt: "asc" },
  });
  if (updates.length === 0) return;

  const ydoc = new Y.Doc();
  for (const u of updates) Y.applyUpdate(ydoc, new Uint8Array(u.update as Buffer));
  const mergedState = Y.encodeStateAsUpdate(ydoc);

  const lastUpdateId = updates[updates.length - 1].id;
  const authorId = updates[updates.length - 1].authorId;

  await prisma.$transaction([
    prisma.documentSnapshot.create({
      data: {
        documentId,
        authorId,
        isAuto: true,
        state: Buffer.from(mergedState),
      },
    }),
    prisma.documentUpdate.deleteMany({
      where: { documentId, id: { in: updates.map((u) => u.id) } },
    }),
    prisma.document.update({
      where: { id: documentId },
      data: { logSizeBytes: 0 },
    }),
  ]);

  void lastUpdateId; // kept for potential audit logging
}
