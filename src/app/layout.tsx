import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Novelista – Schreib deinen Roman",
  description:
    "Die einfache Schreib-App für Romanautoren. Du schreibst, der Rest passiert von selbst.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <head>
        {/* Distinktive literarische Schriften */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,500;0,600;1,400&family=Inter+Tight:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
