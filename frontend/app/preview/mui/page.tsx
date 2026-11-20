import { Suspense } from "react";
import { PreviewMui } from "@/components/preview-mui";

export default function Page() {
  return <Suspense fallback={<p>Loading routes…</p>}><PreviewMui /></Suspense>;
}
