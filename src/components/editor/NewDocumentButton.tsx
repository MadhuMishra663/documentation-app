"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function NewDocumentButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function createDoc() {
    setBusy(true);
    const res = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled Document" }),
    });
    setBusy(false);
    if (res.ok) {
      const doc = await res.json();
      router.push(`/documents/${doc.id}`);
    }
  }

  return (
    <Button onClick={createDoc} disabled={busy}>
      {busy ? "Creating…" : "New document"}
    </Button>
  );
}
