import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Estimator App",
  description: "A professional project estimation tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
