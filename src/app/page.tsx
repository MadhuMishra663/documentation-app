import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { NewDocumentButton } from "@/components/editor/NewDocumentButton";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const docs = await prisma.documentCollaborator.findMany({
    where: { userId: session.user.id },
    include: { document: true },
    orderBy: { document: { updatedAt: "desc" } },
  });

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl">Your documents</h1>
          <p className="text-ink-500 text-sm mt-1">Everything here works offline. Sync happens quietly in the background.</p>
        </div>
        <NewDocumentButton />
      </div>

      {docs.length === 0 ? (
        <div className="border border-dashed border-paper-300 rounded-lg p-10 text-center text-ink-500">
          <p>No documents yet. Create your first one to get started.</p>
        </div>
      ) : (
        <ul className="divide-y divide-paper-300 border border-paper-300 rounded-lg overflow-hidden bg-white">
          {docs.map((d) => (
            <li key={d.document.id}>
              <Link
                href={`/documents/${d.document.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-paper-100 transition-colors"
              >
                <div>
                  <p className="font-medium">{d.document.title}</p>
                  <p className="text-xs text-ink-300 font-mono mt-0.5">
                    updated {new Date(d.document.updatedAt).toLocaleString()}
                  </p>
                </div>
                <span className="text-xs font-mono uppercase text-ink-500 bg-paper-200 rounded px-2 py-1">
                  {d.role.toLowerCase()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
