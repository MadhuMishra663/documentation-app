import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db/prisma";
import { CollaborativeEditor } from "@/components/editor/CollaborativeEditor";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const access = await requireRole(id, session.user.id, "VIEWER");
  if (!access.ok) notFound();

  const doc = await prisma.document.findUnique({ where: { id }, select: { title: true } });
  if (!doc) notFound();

  return <CollaborativeEditor documentId={id} title={doc.title} role={access.role} />;
}
