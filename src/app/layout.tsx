import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledger — local-first collaborative docs",
  description: "A local-first, offline-capable collaborative document editor.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink min-h-screen antialiased">{children}</body>
    </html>
  );
}
