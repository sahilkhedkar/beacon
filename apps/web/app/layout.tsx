import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Beacon",
  description: "A thoughtful research assistant powered by live web search.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
