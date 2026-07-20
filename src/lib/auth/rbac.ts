import { prisma } from "@/lib/db/prisma";
import type { Role } from "@prisma/client";

/**
 * Tenant isolation strategy: since we're using Prisma (not raw SQL), we
 * don't have native Postgres Row Level Security policies wired up by
 * default. Instead every read/write in the API layer MUST go through one of
 * these helpers, which scope the query by (documentId, userId) via the
 * DocumentCollaborator join table. No API route queries `Document` or
 * `DocumentUpdate` directly by id alone — that would let user A read user
 * B's document just by guessing/enumerating a cuid.
 *
 * If you do want real Postgres RLS as a defense-in-depth layer (recommended
 * for production), see the SQL in prisma/rls-policies.sql — apply it with
 * `psql $DATABASE_URL -f prisma/rls-policies.sql` after your first migration.
 * Prisma's connection would then need to run as a non-superuser role and set
 * `app.current_user_id` via `SET LOCAL` per-request for RLS to key off.
 */

const ROLE_RANK: Record<Role, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

export async function getCollaboratorRole(
  documentId: string,
  userId: string
): Promise<Role | null> {
  const collab = await prisma.documentCollaborator.findUnique({
    where: { documentId_userId: { documentId, userId } },
    select: { role: true },
  });
  return collab?.role ?? null;
}

export function hasAtLeastRole(role: Role | null, required: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/** Throws-free guard for use in route handlers; returns the role or null. */
export async function requireRole(
  documentId: string,
  userId: string,
  required: Role
): Promise<{ ok: true; role: Role } | { ok: false; status: number }> {
  const role = await getCollaboratorRole(documentId, userId);
  if (!role) return { ok: false, status: 404 }; // don't leak existence to non-collaborators
  if (!hasAtLeastRole(role, required)) return { ok: false, status: 403 };
  return { ok: true, role };
}
