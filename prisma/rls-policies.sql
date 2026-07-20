-- Optional defense-in-depth: native Postgres Row Level Security, on top of
-- (not instead of) the Prisma-layer scoping in src/lib/auth/rbac.ts.
--
-- Apply after your first `prisma migrate dev`:
--   psql "$DATABASE_URL" -f prisma/rls-policies.sql
--
-- Requires the app to connect as a non-superuser role and to run
--   SET LOCAL app.current_user_id = '<userId>';
-- at the start of each transaction (see src/lib/db/withRls.ts for a helper
-- you can wrap route handlers in).

ALTER TABLE "DocumentCollaborator" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentUpdate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentSnapshot" ENABLE ROW LEVEL SECURITY;

CREATE POLICY collaborator_isolation ON "DocumentCollaborator"
  USING ("userId" = current_setting('app.current_user_id', true));

CREATE POLICY document_isolation ON "Document"
  USING (
    id IN (
      SELECT "documentId" FROM "DocumentCollaborator"
      WHERE "userId" = current_setting('app.current_user_id', true)
    )
  );

CREATE POLICY update_isolation ON "DocumentUpdate"
  USING (
    "documentId" IN (
      SELECT "documentId" FROM "DocumentCollaborator"
      WHERE "userId" = current_setting('app.current_user_id', true)
    )
  );

CREATE POLICY snapshot_isolation ON "DocumentSnapshot"
  USING (
    "documentId" IN (
      SELECT "documentId" FROM "DocumentCollaborator"
      WHERE "userId" = current_setting('app.current_user_id', true)
    )
  );
