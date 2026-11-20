"use client";

import { useLanguage } from "@/lib/language";
import Link from "next/link";
import type { RouteCard } from "./route-simulation";
import { RoutePreview, type PreviewSelectProps } from "./route-preview";
import styles from "./preview-css.module.css";

const Card: RouteCard = ({ title, children, footer }) => <section className={styles.card}>
  <h2>{title}</h2>{children}{footer && <div className={styles.legend}>{footer}</div>}
</section>;

function Select({ label, value, options, onChange }: PreviewSelectProps) {
  const { t } = useLanguage();
  return <label className={styles.field}>{label}
    <select value={value} disabled={!options.length} onChange={(event) => onChange(event.target.value)}>
      {!options.length && <option value={value}>{t("No options")}</option>}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}

export function PreviewCss() {
  const { t } = useLanguage();
  return <div className={styles.shell}>
    <header className={styles.header}>
      <nav aria-label={t("Interface variants")}>
        <Link href="/routes">{t("Main app")}</Link>
        <Link href="/preview/css" aria-current="page">CSS</Link>
        <Link href="/preview/mui">Material UI</Link>
      </nav>
    </header>
    <main><RoutePreview Card={Card} Select={Select} /></main>
  </div>;
}
