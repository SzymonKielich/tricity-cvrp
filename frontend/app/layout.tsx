import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { LanguageProvider } from "@/lib/language";
import { QueryProvider } from "@/components/query-provider";

export const metadata: Metadata = {
  title: "Delivery planning",
  description: "Plan and compare shared delivery routes using Hedyla data.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><LanguageProvider><QueryProvider>{children}</QueryProvider></LanguageProvider></body></html>;
}
