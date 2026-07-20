"use client";

import { clsx } from "clsx";
import type { SyncStatus } from "@/lib/sync/sync-engine";

const CONFIG: Record<SyncStatus, { label: string; dot: string; bg: string; text: string }> = {
  offline: { label: "Offline — editing locally", dot: "bg-ink-300", bg: "bg-paper-200", text: "text-ink-500" },
  syncing: { label: "Syncing…", dot: "bg-amber animate-pulse", bg: "bg-amber-100", text: "text-amber" },
  synced: { label: "All changes saved", dot: "bg-moss", bg: "bg-moss-100", text: "text-moss-600" },
  error: { label: "Sync error — will retry", dot: "bg-rust", bg: "bg-rust-100", text: "text-rust" },
};

export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const cfg = CONFIG[status];
  return (
    <div
      className={clsx("inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium", cfg.bg, cfg.text)}
      role="status"
      aria-live="polite"
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", cfg.dot)} aria-hidden />
      {cfg.label}
    </div>
  );
}
