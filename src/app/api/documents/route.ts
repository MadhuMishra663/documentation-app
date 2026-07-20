import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createDocumentSchema } from "@/lib/validation/schemas";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const docs = await prisma.documentCollaborator.findMany({
    where: { userId: session.user.id },
    include: { document: true },
    orderBy: { document: { updatedAt: "desc" } },
  });

  return NextResponse.json(
    docs.map((d) => ({
      id: d.document.id,
      title: d.document.title,
      role: d.role,
      updatedAt: d.document.updatedAt,
    }))
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createDocumentSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  const doc = await prisma.document.create({
    data: {
      title: parsed.data.title,
      collaborators: {
        create: { userId: session.user.id, role: "OWNER" },
      },
    },
  });

  return NextResponse.json({ id: doc.id, title: doc.title });
}
