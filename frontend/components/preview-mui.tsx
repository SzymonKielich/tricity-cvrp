"use client";

import { useLanguage } from "@/lib/language";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { AppBar, Box, Button, Container, CssBaseline, Paper, Slider, Stack, TextField, Toolbar, Typography } from "@mui/material";
import Link from "next/link";
import { playbackSpeeds } from "@/lib/route-playback";
import { playbackClock, type PlayerProps, type RouteCard } from "./route-simulation";
import { RoutePreview, type PreviewSelectProps } from "./route-preview";

const Card: RouteCard = ({ title, children, footer }) => <Paper component="section" variant="outlined">
  <Typography component="h2" variant="subtitle1" sx={{ px: 2, py: 1.25, fontWeight: 600, borderBottom: 1, borderColor: "divider", overflowWrap: "anywhere" }}>
    {title}
  </Typography>
  {children}
  {footer && <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1} sx={{ px: 2, py: 1, fontSize: ".85rem" }}>{footer}</Stack>}
</Paper>;

function Select({ label, value, options, onChange }: PreviewSelectProps) {
  const { t } = useLanguage();
  return <TextField variant="outlined" size="small" select fullWidth label={label} value={value}
    slotProps={{ select: { native: true }, inputLabel: { shrink: true } }} disabled={!options.length}
    onChange={(event) => onChange(event.target.value)}>
    {!options.length && <option value={value}>{t("No options")}</option>}
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </TextField>;
}

function Player({ time, start, end, speed, playing, toggle, seek, changeSpeed }: PlayerProps) {
  const { t } = useLanguage();
  const limit = Math.ceil(end - start);
  return <>
    <div className="playback-controls">
      <Button variant="contained" onClick={toggle} disabled={!limit}>{playing ? t("Pause") : t("Play")}</Button>
      <output aria-live="off" aria-label={t("Simulation time")} className="simulation-time">{playbackClock(time)}</output>
      <Box sx={{ ml: "auto", minWidth: 106 }}>
        <Select label={t("Speed")} value={String(speed)} onChange={(value) => changeSpeed(Number(value))}
          options={playbackSpeeds.map((option) => ({ label: `${option}×`, value: String(option) }))} />
      </Box>
    </div>
    <Slider aria-label={t("Route time")} getAriaValueText={(value) => playbackClock(Math.min(end, start + value))}
      min={0} max={limit || 1} value={time === end ? limit : Math.floor(time - start)} disabled={!limit}
      onChange={(_, value) => seek(Number(value) === limit ? end : start + Number(value))}
      sx={{ mt: 1, "& .MuiSlider-thumb, & .MuiSlider-track": { transition: "none" } }} />
  </>;
}

export function PreviewMui() {
  const { t } = useLanguage();
  return <AppRouterCacheProvider>
    <CssBaseline />
    <Box sx={{ bgcolor: "grey.50", minHeight: "100dvh", "--accent": "#1976d2", "--accent-soft": "#e3f2fd" }}>
      <AppBar position="static" elevation={0}>
        <Container maxWidth="lg">
          <Toolbar disableGutters>
            <Stack component="nav" aria-label={t("Interface variants")} direction="row" useFlexGap flexWrap="wrap">
              <Button component={Link} color="inherit" href="/routes">{t("Main app")}</Button>
              <Button component={Link} color="inherit" href="/preview/css">CSS</Button>
              <Button component={Link} color="inherit" href="/preview/mui" aria-current="page" variant="outlined">Material UI</Button>
            </Stack>
          </Toolbar>
        </Container>
      </AppBar>
      <Container component="main" maxWidth="lg" sx={{ py: { xs: 2, sm: 3 },
        "& h1": { typography: "h4", fontSize: { xs: "1.65rem", sm: "2.1rem" }, mt: 0, mb: 2.5 } }}>
        <RoutePreview Card={Card} Select={Select} Player={Player} />
      </Container>
    </Box>
  </AppRouterCacheProvider>;
}
