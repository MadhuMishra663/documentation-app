import { NextRequest, NextResponse } from "next/server";
import * as Y from "yjs";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/rbac";

/**
 * Restoring a version does NOT delete update history or truncate the log —
 * that would corrupt other active collaborators' state and destroy
 * auditability. Instead we:
 *
 *   1. Load the target snapshot's content.
 *   2. Diff it against current live state to produce a Yjs update that
 *      transforms current -> snapshot content.
 *   3. Insert that diff as a normal DocumentUpdate row, authored by the
 *      restoring user, exactly like any other edit.
 *
 * Every connected client (including ones who kept typing during the
 * restore) receives this as a regular incoming update through the same
 * pull path as any collaborator's edit, and Yjs merges it deterministically
 * with whatever they were doing. "Restore" is just a big edit, not a
 * special destructive operation — which is precisely what keeps it safe
 * for concurrent collaborators, per the assignment's requirement.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id: documentId, versionId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = await requireRole(documentId, session.user.id, "EDITOR");
  if (!access.ok) return NextResponse.json({ error: "forbidden" }, { status: access.status });

  const target = await prisma.documentSnapshot.findUnique({ where: { id: versionId } });
  if (!target || target.documentId !== documentId) {
    return NextResponse.json({ error: "version not found" }, { status: 404 });
  }

  // Rebuild current live state (latest snapshot + updates since).
  const currentDoc = new Y.Doc();
  const latestSnapshot = await prisma.documentSnapshot.findFirst({
    where: { documentId },
    orderBy: { createdAt: "desc" },
  });
  if (latestSnapshot) Y.applyUpdate(currentDoc, new Uint8Array(latestSnapshot.state as Buffer));
  const updatesSince = await prisma.documentUpdate.findMany({
    where: { documentId, ...(latestSnapshot ? { createdAt: { gt: latestSnapshot.createdAt } } : {}) },
    orderBy: { createdAt: "asc" },
  });
  for (const u of updatesSince) Y.applyUpdate(currentDoc, new Uint8Array(u.update as Buffer));

  const targetContent = (() => {
    const d = new Y.Doc();
    Y.applyUpdate(d, new Uint8Array(target.state as Buffer));
    return d.getText("content").toString();
  })();

  const before = Y.encodeStateVector(currentDoc);
  currentDoc.transact(() => {
    const ytext = currentDoc.getText("content");
    ytext.delete(0, ytext.length);
    ytext.insert(0, targetContent);
  }, "restore");
  const restoreDiff = Y.encodeStateAsUpdate(currentDoc, before);

  const clientMsgId = crypto.randomUUID();
  await prisma.documentUpdate.create({
    data: {
      documentId,
      authorId: session.user.id,
      clientMsgId,
      update: Buffer.from(restoreDiff),
      sizeBytes: restoreDiff.length,
    },
  });
  await prisma.document.update({
    where: { id: documentId },
    data: { logSizeBytes: { increment: restoreDiff.length }, updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true, restoredFrom: versionId });
}
