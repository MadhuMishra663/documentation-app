import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/rbac";
import { inviteCollaboratorSchema } from "@/lib/validation/schemas";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = await requireRole(id, session.user.id, "VIEWER");
  if (!access.ok) return NextResponse.json({ error: "not found" }, { status: access.status });

  const doc = await prisma.document.findUnique({
    where: { id },
    include: { collaborators: { include: { user: { select: { id: true, name: true, email: true } } } } },
  });

  return NextResponse.json({ ...doc, myRole: access.role });
}

// Only an OWNER can invite collaborators.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = await requireRole(id, session.user.id, "OWNER");
  if (!access.ok) return NextResponse.json({ error: "forbidden" }, { status: access.status });

  const parsed = inviteCollaboratorSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  const invitedUser = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!invitedUser) return NextResponse.json({ error: "no user with that email" }, { status: 404 });

  const collab = await prisma.documentCollaborator.upsert({
    where: { documentId_userId: { documentId: id, userId: invitedUser.id } },
    update: { role: parsed.data.role },
    create: { documentId: id, userId: invitedUser.id, role: parsed.data.role },
  });

  return NextResponse.json(collab);
}
