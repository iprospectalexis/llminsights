/**
 * Tiny load-phase telemetry for the project dashboards. Durations land
 * in window.__llmiPerf and one console.info line per load, so real
 * user timings replace model-based estimates when diagnosing speed.
 */
const started: Record<string, number> = {};

export const perfStart = (key: string): void => {
  started[key] = performance.now();
};

export const perfEnd = (key: string): number => {
  const t0 = started[key];
  if (t0 === undefined) return 0;
  const ms = Math.round(performance.now() - t0);
  const w = window as any;
  w.__llmiPerf = { ...(w.__llmiPerf || {}), [key]: ms };
  return ms;
};

export const perfReport = (label: string): void => {
  const w = window as any;
  // eslint-disable-next-line no-console
  console.info(`[llmi-perf] ${label}`, w.__llmiPerf || {});
};
