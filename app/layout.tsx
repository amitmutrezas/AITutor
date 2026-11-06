import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TestModeBanner } from "../components/layout/TestModeBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Unstuck",
  description: "A hint-ladder coding tutor for career switchers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TestModeBanner />
        {children}
      </body>
    </html>
  );
}
