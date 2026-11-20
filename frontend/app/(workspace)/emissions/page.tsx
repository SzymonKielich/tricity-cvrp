import type { Metadata } from "next";
import { Suspense } from "react";
import { Emissions } from "@/components/emissions";

export const metadata: Metadata = { title: "Emissions by distance" };

export default function Page() {
  return <Suspense fallback={null}><Emissions /></Suspense>;
}
