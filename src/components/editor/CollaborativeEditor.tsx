"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { CrdtDocument } from "@/lib/sync/crdt-doc";
import { SyncEngine, type SyncStatus } from "@/lib/sync/sync-engine";
import { localDB } from "@/lib/db/local-db";
import { SyncStatusBadge } from "./SyncStatusBadge";
import { VersionTimeline } from "./VersionTimeline";
import { Button } from "@/components/ui/button";

type Role = "OWNER" | "EDITOR" | "VIEWER";

export function CollaborativeEditor({
  documentId,
  title,
  role,
}: {
  documentId: string;
  title: string;
  role: Role;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<SyncStatus>("offline");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const docRef = useRef<CrdtDocument | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const canEdit = role === "OWNER" || role === "EDITOR";

  useEffect(() => {
    let cancelled = false;
    const doc = new CrdtDocument(documentId);
    docRef.current = doc;

    void localDB.documentMeta.put({
      documentId,
      title,
      role,
      lastSyncedAt: null,
      lastKnownServerCursor: null,
      dirty: false,
    });

    doc.whenSynced().then(() => {
      if (cancelled) return;
      setText(doc.ytext.toString());
    });

    // Reflect every CRDT-level change (local keystrokes AND remote peers'
    // edits arriving via sync) back into the textarea. This is what makes
    // remote updates show up live without the user doing anything.
    const observer = () => setText(doc.ytext.toString());
    doc.ytext.observe(observer);

    const engine = new SyncEngine(doc);
    engineRef.current = engine;
    const unsub = engine.onStatusChange(setStatus);
    engine.start();

    // Periodic background flush as a safety net in addition to online/offline
    // event-driven syncing — catches cases like a flaky connection that
    // never fires a clean `offline` event.
    const interval = setInterval(() => void engine.flush(), 15_000);

    return () => {
      cancelled = true;
      doc.ytext.unobserve(observer);
      unsub();
      engine.stop();
      clearInterval(interval);
      doc.destroy();
    };
  }, [documentId, title, role]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!canEdit || !docRef.current) return;
    const newValue = e.target.value;
    const doc = docRef.current;
    const oldValue = doc.ytext.toString();

    // Minimal-diff textarea sync: rather than clobbering the whole Y.Text on
    // every keystroke (which would blow away fine-grained CRDT position
    // info), compute the common prefix/suffix and apply just the delta as an
    // insert/delete. This keeps merges precise when two people type in
    // different parts of the doc concurrently.
    let start = 0;
    while (start < oldValue.length && start < newValue.length && oldValue[start] === newValue[start]) start++;
    let endOld = oldValue.length;
    let endNew = newValue.length;
    while (endOld > start && endNew > start && oldValue[endOld - 1] === newValue[endNew - 1]) {
      endOld--;
      endNew--;
    }

    doc.ydoc.transact(() => {
      if (endOld > start) doc.ytext.delete(start, endOld - start);
      if (endNew > start) doc.ytext.insert(start, newValue.slice(start, endNew));
    });
    // Local state updates via the observer above; setText here too for snappy input feel.
    setText(newValue);
  }, [canEdit]);

  async function handleRestore(versionId: string) {
    await fetch(`/api/documents/${documentId}/versions/${versionId}/restore`, { method: "POST" });
    await engineRef.current?.flush();
  }

  async function runAi(mode: "summarize" | "improve" | "continue") {
    setAiBusy(true);
    setAiResult(null);
    try {
      const res = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, content: text, mode }),
      });
      const data = await res.json();
      setAiResult(res.ok ? data.result : data.error);
    } catch {
      setAiResult("AI request failed — check your connection.");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="flex h-screen">
      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-paper-300 bg-paper-50 px-6 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="font-serif text-lg truncate">{title}</h1>
            <p className="font-mono text-xs text-ink-300 uppercase tracking-wide">{role.toLowerCase()}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {!canEdit && (
              <span className="text-xs text-ink-500 bg-paper-200 rounded px-2 py-1">Read only</span>
            )}
            <SyncStatusBadge status={status} />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-10 py-8">
          <textarea
            className="editor-surface w-full min-h-[70vh] bg-transparent resize-none"
            value={text}
            onChange={handleChange}
            readOnly={!canEdit}
            placeholder={canEdit ? "Start writing…" : "This document has no content yet."}
            aria-label={`Editor for ${title}`}
          />
        </div>

        <footer className="border-t border-paper-300 bg-paper-50 px-6 py-3 flex items-center gap-2">
          <span className="font-mono text-xs text-ink-300 mr-2">AI</span>
          <Button variant="ghost" disabled={aiBusy} onClick={() => runAi("summarize")}>
            Summarize
          </Button>
          <Button variant="ghost" disabled={aiBusy} onClick={() => runAi("improve")}>
            Suggest improvements
          </Button>
          {canEdit && (
            <Button variant="ghost" disabled={aiBusy} onClick={() => runAi("continue")}>
              Continue writing
            </Button>
          )}
          {aiBusy && <span className="text-xs text-ink-300">Thinking…</span>}
        </footer>

        {aiResult && (
          <div className="mx-6 mb-4 rounded border border-moss-100 bg-moss-100/60 px-4 py-3 text-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-xs uppercase text-moss-600">AI suggestion</span>
              <button onClick={() => setAiResult(null)} className="text-xs text-ink-500">
                dismiss
              </button>
            </div>
            <p className="whitespace-pre-wrap">{aiResult}</p>
          </div>
        )}
      </div>

      <VersionTimeline documentId={documentId} canEdit={canEdit} onRestore={handleRestore} />
    </div>
  );
}
