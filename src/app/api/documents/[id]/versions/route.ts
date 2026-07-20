import { NextRequest, NextResponse } from "next/server";
import * as Y from "yjs";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/rbac";
import { saveVersionSchema } from "@/lib/validation/schemas";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = await requireRole(documentId, session.user.id, "VIEWER");
  if (!access.ok) return NextResponse.json({ error: access.status === 403 ? "forbidden" : "not found" }, { status: access.status });

  const snapshots = await prisma.documentSnapshot.findMany({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      isAuto: true,
      createdAt: true,
      author: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json(snapshots);
}

/**
 * Save a named checkpoint. We replay the current update log (+ latest
 * snapshot as a base, if any) into a fresh Y.Doc and store the resulting
 * state — this is what "capture a specific snapshot" means concretely.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = await requireRole(documentId, session.user.id, "EDITOR");
  if (!access.ok) return NextResponse.json({ error: "forbidden" }, { status: access.status });

  const parsed = saveVersionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  const ydoc = new Y.Doc();

  const latestSnapshot = await prisma.documentSnapshot.findFirst({
    where: { documentId },
    orderBy: { createdAt: "desc" },
  });
  if (latestSnapshot) Y.applyUpdate(ydoc, new Uint8Array(latestSnapshot.state as Buffer));

  const updatesSince = await prisma.documentUpdate.findMany({
    where: { documentId, ...(latestSnapshot ? { createdAt: { gt: latestSnapshot.createdAt } } : {}) },
    orderBy: { createdAt: "asc" },
  });
  for (const u of updatesSince) Y.applyUpdate(ydoc, new Uint8Array(u.update as Buffer));

  const snapshot = await prisma.documentSnapshot.create({
    data: {
      documentId,
      authorId: session.user.id,
      label: parsed.data.label ?? null,
      isAuto: false,
      state: Buffer.from(Y.encodeStateAsUpdate(ydoc)),
    },
  });

  return NextResponse.json({ id: snapshot.id, label: snapshot.label, createdAt: snapshot.createdAt });
}
