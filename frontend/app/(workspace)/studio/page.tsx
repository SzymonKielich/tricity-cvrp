import type { Metadata } from "next";
import { Suspense } from "react";
import { Studio } from "@/components/studio";

export const metadata: Metadata = { title: "Optimization studio" };
export default function Page() { return <Suspense fallback={null}><Studio /></Suspense>; }
