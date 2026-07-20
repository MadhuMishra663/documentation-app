"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Snapshot {
  id: string;
  label: string | null;
  isAuto: boolean;
  createdAt: string;
  author: { name: string | null; email: string };
}

export function VersionTimeline({
  documentId,
  canEdit,
  onRestore,
}: {
  documentId: string;
  canEdit: boolean;
  onRestore: (versionId: string) => void;
}) {
  const [versions, setVersions] = useState<Snapshot[]>([]);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch(`/api/documents/${documentId}/versions`);
    if (res.ok) setVersions(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [documentId]);

  async function saveVersion() {
    await fetch(`/api/documents/${documentId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label || undefined }),
    });
    setLabel("");
    void load();
  }

  return (
    <aside className="w-72 shrink-0 border-l border-paper-300 bg-paper-50/60 h-full flex flex-col">
      <div className="p-4 border-b border-paper-300">
        <h2 className="font-mono text-xs uppercase tracking-wide text-ink-500 mb-2">Version history</h2>
        {canEdit && (
          <div className="flex gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label this version…"
              className="flex-1 text-sm rounded border border-paper-300 bg-white px-2 py-1 focus-visible:outline-moss"
            />
            <Button variant="secondary" onClick={saveVersion} className="shrink-0">
              Save
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto ledger-rule">
        {loading && <p className="p-4 text-sm text-ink-300">Loading…</p>}
        {!loading && versions.length === 0 && (
          <p className="p-4 text-sm text-ink-300">No versions saved yet. Every keystroke is still tracked in the live sync log.</p>
        )}
        <ul>
          {versions.map((v) => (
            <li key={v.id} className="px-4 h-[27px] flex items-center justify-between group">
              <div className="min-w-0">
                <p className="text-sm truncate font-medium">
                  {v.label ?? (v.isAuto ? "Auto checkpoint" : "Untitled version")}
                </p>
              </div>
              {canEdit && (
                <button
                  onClick={() => onRestore(v.id)}
                  className="text-xs font-mono text-moss opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2"
                >
                  restore
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
