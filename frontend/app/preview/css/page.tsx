import { Suspense } from "react";
import { PreviewCss } from "@/components/preview-css";

export default function Page() {
  return <Suspense fallback={<p>Loading routes…</p>}><PreviewCss /></Suspense>;
}
