import type { Metadata } from "next";
import "mapbox-gl/dist/mapbox-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Texas Party Support Map",
  description: "City-level Texas 2024 presidential support map with election-return methodology notes."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
