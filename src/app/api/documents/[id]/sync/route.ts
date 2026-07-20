import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/rbac";
import { syncPushSchema } from "@/lib/validation/schemas";
import { maybeCompact } from "@/lib/sync/compaction";

const MAX_SYNC_PAYLOAD_BYTES = Number(process.env.MAX_SYNC_PAYLOAD_BYTES ?? 2_000_000);

/**
 * POST = push local updates to the server.
 * GET  = pull remote updates since a cursor (incremental sync).
 *
 * Both routes are idempotent and safe to retry — see sync-engine.ts for the
 * client-side reasoning. Server-side, idempotency comes from the
 * @@unique([documentId, clientMsgId]) constraint on DocumentUpdate: resending
 * the same batch after a dropped response just hits a unique-constraint
 * conflict, which we treat as success (already-applied), not an error.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // --- Guardrail 1: reject oversized bodies BEFORE parsing JSON -----------
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_SYNC_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  // Viewers must not be able to push state updates — enforced here, not just
  // hidden in the UI.
  const access = await requireRole(documentId, session.user.id, "EDITOR");
  if (!access.ok) return NextResponse.json({ error: "forbidden" }, { status: access.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // --- Guardrail 2: schema + per-item size validation ----------------------
  const parsed = syncPushSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { updates } = parsed.data;
  let totalBytes = 0;

  for (const u of updates) totalBytes += u.update.length;
  if (totalBytes > MAX_SYNC_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  // Insert each update; unique constraint violations (duplicate clientMsgId
  // from a retried request) are swallowed as already-applied, not surfaced
  // as errors — this is the idempotency guarantee.
  let appliedBytes = 0;
  for (const u of updates) {
    try {
      await prisma.documentUpdate.create({
        data: {
          documentId,
          authorId: session.user.id,
          clientMsgId: u.clientMsgId,
          update: Buffer.from(u.update),
          sizeBytes: u.update.length,
        },
      });
      appliedBytes += u.update.length;
    } catch (err: any) {
      if (err?.code !== "P2002") throw err; // P2002 = unique constraint = already applied, fine
    }
  }

  if (appliedBytes > 0) {
    await prisma.document.update({
      where: { id: documentId },
      data: {
        logSizeBytes: { increment: appliedBytes },
        updatedAt: new Date(),
      },
    });
    // Fire-and-forget compaction check — never block the response on it.
    void maybeCompact(documentId);
  }

  return NextResponse.json({ ok: true, applied: updates.length });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = await requireRole(documentId, session.user.id, "VIEWER");
  if (!access.ok) return NextResponse.json({ error: "forbidden" }, { status: access.status });

  const since = req.nextUrl.searchParams.get("since");
  const rows = await prisma.documentUpdate.findMany({
    where: {
      documentId,
      ...(since ? { createdAt: { gt: new Date(since) } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 500, // bounded pull batch — client will page again if there's more
  });

  const cursor = rows.length > 0 ? rows[rows.length - 1].createdAt.toISOString() : since;

  return NextResponse.json({
    updates: rows.map((r) => ({ update: Array.from(r.update as Buffer) })),
    cursor,
  });
}
