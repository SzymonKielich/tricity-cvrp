"use client";

import { useLanguage, type Language } from "@/lib/language";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { Box, CssBaseline, Drawer, IconButton, ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import { plPL as materialPolish } from "@mui/material/locale";
import { plPL as gridPolish } from "@mui/x-data-grid/locales";
import type {} from "@mui/x-charts/themeAugmentation";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { CalendarClock, ChartNoAxesCombined, ChevronRight, CircleHelp, FolderClosed, GitCompareArrows, LayoutDashboard, Leaf, MapPin, Menu, Moon, Route, SlidersHorizontal, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const useAppearance = create<{ dark: boolean; toggle: () => void }>()(persist(
  (set) => ({ dark: false, toggle: () => set((state) => ({ dark: !state.dark })) }),
  { name: "shareddrop-appearance", skipHydration: true },
));

const nav = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Network explorer", href: "/network", icon: MapPin },
  { label: "Optimization studio", href: "/studio", icon: SlidersHorizontal },
  { label: "Route explorer", href: "/routes", icon: Route },
  { label: "Operations timeline", href: "/operations", icon: CalendarClock },
  { label: "Scenario comparison", href: "/compare", icon: GitCompareArrows },
  { label: "Impact analytics", href: "/impact", icon: ChartNoAxesCombined },
  { label: "Emissions by distance", href: "/emissions", icon: Leaf },
  { label: "Scenario library", href: "/scenarios", icon: FolderClosed },
];

function theme(dark: boolean, language: Language) {
  return createTheme({
    palette: {
      mode: dark ? "dark" : "light",
      primary: { main: dark ? "#5de4be" : "#08765f", contrastText: dark ? "#0e201c" : "#fff" },
      background: { default: dark ? "#111b1a" : "#f4f7f6", paper: dark ? "#182423" : "#fff" },
      text: { primary: dark ? "#eef6f3" : "#182923", secondary: dark ? "#aabcb6" : "#566862" },
      divider: dark ? "#32443e" : "#dfe7e3",
      success: { main: dark ? "#5de4be" : "#157457" },
    },
    shape: { borderRadius: 8 },
    typography: { fontFamily: '"Inter Variable", Inter, system-ui, sans-serif', button: { textTransform: "none", fontWeight: 650 } },
    components: {
      MuiChartsLocalizationProvider: {
        defaultProps: language === "pl" ? { localeText: { loading: "Wczytywanie danych…", noData: "Brak danych do wyświetlenia" } } : {},
      },
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 38, paddingInline: 13, whiteSpace: "nowrap" } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 650, fontSize: 12, height: 25, borderRadius: 6 } } },
      MuiInputBase: { styleOverrides: { root: { fontSize: 13 } } },
      MuiFormHelperText: { styleOverrides: { root: { marginLeft: 0, lineHeight: 1.35 } } },
      MuiTooltip: { styleOverrides: { tooltip: { fontSize: 12 } } },
    },
  }, ...(language === "pl" ? [materialPolish, gridPolish] : []));
}

const themes = {
  en: [theme(false, "en"), theme(true, "en")],
  pl: [theme(false, "pl"), theme(true, "pl")],
};

function Sidebar({ pathname, close }: { pathname: string; close?: () => void }) {
  const { t } = useLanguage();
  return <aside className="sidebar">
    <nav aria-label={t("Main navigation")}>
      {nav.map(({ label, href, icon: Icon }) =>
        <Link href={href} className={pathname === href ? "nav-link selected" : "nav-link"}
          aria-current={pathname === href ? "page" : undefined} key={href} onClick={close}>
          <Icon size={17} /><span>{t(label)}</span>{pathname === href && <ChevronRight size={14} className="nav-chevron" />}
        </Link>)}
    </nav>
  </aside>;
}

export function Shell({ children }: { children: ReactNode }) {
  const { t, language, setLanguage } = useLanguage();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const dark = useAppearance((state) => state.dark);
  const toggle = useAppearance((state) => state.toggle);
  // Rehydrate after server rendering so the first client render matches the HTML.
  useEffect(() => { void useAppearance.persist.rehydrate(); }, []);
  return <AppRouterCacheProvider>
      <ThemeProvider theme={themes[language][dark ? 1 : 0]}>
        <CssBaseline enableColorScheme />
        <div className="shell" data-theme={dark ? "dark" : "light"}>
          <div className="desktop-sidebar"><Sidebar pathname={pathname} /></div>
          <Drawer open={drawer} onClose={() => setDrawer(false)} slotProps={{ paper: { sx: { width: 236 } } }}>
            <Sidebar pathname={pathname} close={() => setDrawer(false)} />
          </Drawer>
          <div className="workspace">
            <header className="topbar">
              <IconButton aria-label={t("Open navigation")} onClick={() => setDrawer(true)} className="mobile-menu"><Menu size={20} /></IconButton>
              <div className="top-actions">
                <ToggleButtonGroup exclusive size="small" value={language} aria-label={t("Language")}
                  onChange={(_, next: Language | null) => { if (next) setLanguage(next); }}
                  sx={{ "& .MuiToggleButton-root": { fontSize: 12, lineHeight: 1, px: 1, minHeight: 32 } }}>
                  <ToggleButton value="en" aria-label="English" lang="en">EN</ToggleButton>
                  <ToggleButton value="pl" aria-label="Polski" lang="pl">PL</ToggleButton>
                </ToggleButtonGroup>
                <Tooltip title={dark ? t("Switch to light mode") : t("Switch to dark mode")}>
                  <IconButton size="small" aria-label={dark ? t("Switch to light mode") : t("Switch to dark mode")} onClick={toggle}>
                    {dark ? <Sun size={18} /> : <Moon size={18} />}
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("API reference")}>
                  <IconButton size="small" component="a" href="/api/docs" target="_blank" aria-label={t("API reference")}><CircleHelp size={19} /></IconButton>
                </Tooltip>
              </div>
            </header>
            <Box component="main" className="content">{children}</Box>
          </div>
        </div>
      </ThemeProvider>
  </AppRouterCacheProvider>;
}
