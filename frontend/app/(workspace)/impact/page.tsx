import type { Metadata } from "next";
import { Suspense } from "react";
import { Impact } from "@/components/impact";

export const metadata: Metadata = { title: "Impact analytics" };
export default function Page() { return <Suspense fallback={null}><Impact /></Suspense>; }
