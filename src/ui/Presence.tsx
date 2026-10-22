import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/** How long a closing dialog stays on screen to play its exit (theme-sunset.css). */
export const EXIT_MS = 150;

const Leaving = createContext(false);

/** True while the surrounding <Presence> plays its exit (for dialogs rendered into a portal). */
export function useLeaving() {
  return useContext(Leaving);
}

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Shows its children while `show` is true and keeps them EXIT_MS longer after
 * it turns false, marked as leaving (class `presence-leaving`, `inert`), so a
 * dialog can fade out instead of vanishing. With reduced motion it goes at once.
 * The children are rendered as they are during the exit: they must not depend
 * on data that becomes empty when `show` turns false.
 */
export function Presence({ show, children }: { show: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(show);
  if (show && !mounted) setMounted(true);
  useEffect(() => {
    if (show || !mounted) return;
    const timer = setTimeout(() => setMounted(false), reducedMotion() ? 0 : EXIT_MS);
    return () => clearTimeout(timer);
  }, [show, mounted]);
  if (!show && !mounted) return null;
  const leaving = !show;
  return (
    <Leaving.Provider value={leaving}>
      <div className={leaving ? "presence presence-leaving" : "presence"} inert={leaving || undefined}>
        {children}
      </div>
    </Leaving.Provider>
  );
}
