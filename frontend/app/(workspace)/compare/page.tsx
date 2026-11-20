import type { Metadata } from "next";
import { Suspense } from "react";
import { Compare } from "@/components/compare";

export const metadata: Metadata = { title: "Scenario comparison" };
export default function Page() { return <Suspense fallback={null}><Compare /></Suspense>; }
