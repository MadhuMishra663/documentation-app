# Ledger — a local-first collaborative document editor

A document editor where editing never blocks on the network, offline edits
from multiple people merge deterministically with no data loss, and every
document has full, restorable version history.

Built for a take-home assignment. This README doubles as the design
rationale — read it before a follow-up conversation about the code, since
the "why" here matters as much as the "what."

## Why the pieces are what they are

**Conflict resolution: Yjs (CRDT), not hand-rolled OT.**
The assignment explicitly warns against building a basic app and asks for a
real "complex data merging algorithm." Rather than hand-rolling operational
transforms (notoriously easy to get subtly wrong), this uses Yjs, a
production-grade CRDT with a proven mathematical guarantee: applying the
same updates in any order, any number of times, on any replica converges to
an identical document (strong eventual consistency). `tests/conflict-resolution.test.ts`
proves this directly — two clients edit offline and concurrently, updates
are applied in reversed order on two separate replicas, and both converge to
the same string with neither edit lost.

**Local-first: IndexedDB is the source of truth, not a cache.**
`y-indexeddb` persists the CRDT doc locally; `src/lib/db/local-db.ts` (Dexie)
holds the outbound sync queue. The editor (`CollaborativeEditor.tsx`) reads
and writes only to the local Yjs doc — there is no `await fetch()` in the
typing path. Network activity happens entirely in the background via
`SyncEngine`.

**Background sync: queue + idempotent push/pull, not "save on click."**
`src/lib/sync/sync-engine.ts` drains a local queue of CRDT updates to
`POST /api/documents/[id]/sync`, and separately pulls anything new via
`GET`. Both are idempotent (client-generated `clientMsgId` + a unique DB
constraint), so retries after a dropped connection never duplicate or lose
an edit. See the class doc comment there for the specific race conditions
handled (double-flush, thundering herd on reconnect, lost-update-on-retry).

**Version history: restore is an edit, not an overwrite.**
Restoring to an old version doesn't truncate history or force-write shared
state — that would corrupt what other active collaborators are looking at.
Instead the server computes the diff from current state to the target
snapshot's content and applies it as an ordinary new CRDT update (see
`versions/[versionId]/restore/route.ts`). `tests/version-restore.test.ts`
proves a collaborator's concurrent edit survives a restore happening at the
same time.

**Auth/roles:** Auth.js (NextAuth) with credentials login; role
(`OWNER`/`EDITOR`/`VIEWER`) lives in `DocumentCollaborator`, checked in every
API route via `requireRole()`. Viewers get 403 on the sync `POST` route —
they can pull and read but never push.

**Security / OOM mitigation for sync payloads:** layered — platform body
limit, `Content-Length` check before `JSON.parse`, Zod schema validation,
per-update byte cap, per-request update-count cap. Full breakdown in
`src/lib/validation/schemas.ts`.

**Scalability — bounding the update log:** an append-only log of every
keystroke grows forever if left alone. `src/lib/sync/compaction.ts` merges
the log into a snapshot and prunes it once it crosses a size threshold,
without touching user-named version-history checkpoints.

## Stack

Next.js 16 (App Router, TS) · Tailwind CSS · PostgreSQL + Prisma · Auth.js ·
Yjs + y-indexeddb (CRDT/local-first) · Dexie (sync queue) · Zod (validation)
· OpenAI/Groq (AI add-on) · optional standalone `ws` relay for sub-second
realtime (HTTP polling sync is the source of truth; the relay is a latency
upgrade only, see `server/ws-server.ts`).

## Folder structure

```
collab-editor/
├── .env.example              # copy to .env, paste your DB string + secrets
├── prisma/
│   ├── schema.prisma          # Document, DocumentUpdate (CRDT log), DocumentSnapshot, roles
│   ├── rls-policies.sql       # optional native Postgres RLS, defense-in-depth
│   └── seed.ts                # demo users + doc for local dev
├── server/
│   └── ws-server.ts           # optional realtime relay (deploy separately from Next.js)
├── src/
│   ├── app/
│   │   ├── page.tsx                        # dashboard / document list
│   │   ├── login/page.tsx
│   │   ├── documents/[id]/page.tsx         # authorizes, renders the editor
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── documents/route.ts                          # list/create
│   │       ├── documents/[id]/route.ts                     # detail/invite
│   │       ├── documents/[id]/sync/route.ts                # push/pull CRDT updates
│   │       ├── documents/[id]/versions/route.ts             # list/save snapshots
│   │       ├── documents/[id]/versions/[versionId]/restore/route.ts
│   │       └── ai/summarize/route.ts
│   ├── components/
│   │   ├── editor/CollaborativeEditor.tsx  # wires CRDT doc + sync engine + UI
│   │   ├── editor/SyncStatusBadge.tsx
│   │   ├── editor/VersionTimeline.tsx
│   │   └── ui/button.tsx
│   └── lib/
│       ├── db/{local-db,prisma}.ts
│       ├── sync/{crdt-doc,sync-engine,compaction}.ts
│       ├── auth/{auth,rbac}.ts
│       ├── validation/schemas.ts
│       └── ai/client.ts
└── tests/
    ├── conflict-resolution.test.ts   # proves order-independent, lossless merge
    └── version-restore.test.ts       # proves restore doesn't clobber concurrent edits
```

## Running it locally

```bash
npm install
cp .env.example .env        # paste your PostgreSQL connection string + a NEXTAUTH_SECRET
npx prisma migrate dev --name init
npx tsx prisma/seed.ts      # optional demo users: owner@example.com / password123
npm run dev
```

Run the test suite (this is the part actually worth running before you
submit — it verifies the merge and restore guarantees, not just that the
code compiles):

```bash
npm test
```

Optional realtime relay (sub-second collab beyond the 15s poll cadence):

```bash
npm run ws-server
```

## Deployment

Deploy the Next.js app to Vercel (or any Node host); point `DATABASE_URL` at
a hosted Postgres (Supabase/Neon/Railway all work with Prisma unchanged).
The optional `ws-server` is a long-lived process and won't run on
serverless — deploy it separately (Fly.io/Render) if you want it, or skip it
entirely; the app is fully correct without it, just slightly less snappy
for two people typing at once while both online.

## Swapping Postgres for MongoDB

The relational bits that actually need Postgres are the `Role` enum and the
`@@unique` idempotency constraint. If you'd rather point `MONGODB_URI` at
your own Atlas cluster: the `DocumentUpdate` log and `DocumentSnapshot`
tables are schema-light (id, documentId, binary blob, timestamp) and map
cleanly onto Mongo collections with a compound unique index on
`(documentId, clientMsgId)`. `DocumentCollaborator` role-checking logic in
`rbac.ts` is store-agnostic — swap the Prisma calls for a Mongo driver and
the rest of the app (sync engine, CRDT logic, UI) is unaffected.
