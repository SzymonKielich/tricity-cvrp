import type { Metadata } from "next";
import { Suspense } from "react";
import { Operations } from "@/components/operations";

export const metadata: Metadata = { title: "Operations timeline" };
export default function Page() { return <Suspense fallback={null}><Operations /></Suspense>; }
