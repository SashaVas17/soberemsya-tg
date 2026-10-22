import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { prefersReducedMotion } from "../motion";

/** How long a closing dialog stays on screen to play its exit (theme-sunset.css). */
export const EXIT_MS = 150;

const Leaving = createContext(false);

/** True while the surrounding <Presence> plays its exit (a dialog in a portal marks itself). */
export function useLeaving() {
  return useContext(Leaving);
}

/** The wrapper that carries the exit class; a portal dialog renders it inside the portal. */
export function PresenceFrame({ leaving, children }: { leaving: boolean; children: ReactNode }) {
  return (
    <div className={leaving ? "presence presence-leaving" : "presence"} inert={leaving || undefined}>
      {children}
    </div>
  );
}

/**
 * Shows its children while `show` is true and keeps them EXIT_MS longer after
 * it turns false, marked as leaving, so a dialog can fade out instead of
 * vanishing. During the exit it shows the children as they last were while
 * open (no text flips while fading). Reopened during the exit, the children
 * mount afresh. With reduced motion the dialog goes at once.
 */
export function Presence({ show, children, portal = false }: { show: boolean; children: ReactNode; portal?: boolean }) {
  const [mounted, setMounted] = useState(show);
  const [generation, setGeneration] = useState(0);
  const [wasShown, setWasShown] = useState(show);
  if (show !== wasShown) {
    setWasShown(show);
    if (show) {
      if (mounted) setGeneration((value) => value + 1);
      setMounted(true);
    }
  }
  const lastShown = useRef<ReactNode>(show ? children : null);
  useLayoutEffect(() => {
    if (show) lastShown.current = children;
  });
  useEffect(() => {
    if (show || !mounted) return;
    const timer = setTimeout(() => setMounted(false), prefersReducedMotion() ? 0 : EXIT_MS);
    return () => clearTimeout(timer);
  }, [show, mounted]);
  if (!show && !mounted) return null;
  const leaving = !show;
  const content = leaving ? lastShown.current : children;
  return (
    <Leaving.Provider key={generation} value={leaving}>
      {portal ? content : <PresenceFrame leaving={leaving}>{content}</PresenceFrame>}
    </Leaving.Provider>
  );
}
