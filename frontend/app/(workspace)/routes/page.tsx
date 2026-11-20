import type { Metadata } from "next";
import { Suspense } from "react";
import { RouteExplorer } from "@/components/routes";

export const metadata: Metadata = { title: "Route explorer" };
export default function Page() { return <Suspense fallback={null}><RouteExplorer /></Suspense>; }
