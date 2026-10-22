/** The person asked the system for less motion (Accessibility → Reduce motion). */
export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

const LOGO_GLOW_KEY = "flockly:logo-glow-day";
let logoGlow: boolean | undefined;

/** True once per day (and per page load): the logo's "o" lights up when the app opens. */
export function logoGlowsToday() {
  if (logoGlow !== undefined) return logoGlow;
  logoGlow = false;
  if (prefersReducedMotion()) return logoGlow;
  try {
    const today = new Date().toDateString();
    if (localStorage.getItem(LOGO_GLOW_KEY) !== today) {
      localStorage.setItem(LOGO_GLOW_KEY, today);
      logoGlow = true;
    }
  } catch {
    // Storage can be blocked; the logo simply stays still.
  }
  return logoGlow;
}
