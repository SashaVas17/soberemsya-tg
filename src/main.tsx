import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppShell } from "./AppShell";
import { telegram } from "./telegram";
import { applyTheme, initialResolvedTheme } from "./theme";
import "./design-tokens.css";
import "./styles.css";

applyTheme(initialResolvedTheme(telegram()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppShell>
      <App />
    </AppShell>
  </StrictMode>,
);
