import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";

import { Header } from "./components/header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RagPDF",
  description: "Upload a PDF. Ask questions. Understand more.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body
          className={`${geistSans.variable} ${geistMono.variable} flex min-h-dvh flex-col antialiased`}
        >
          <Header />
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
