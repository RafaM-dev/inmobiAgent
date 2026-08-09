import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { SessionProvider } from "./auth/session-context";
import { applyTheme, readTheme } from "./components/theme";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Falta el contenedor #root en index.html");

/*
 * El tema se aplica ANTES del primer render.
 *
 * Si esperara al efecto de React, quien tiene el panel en oscuro vería un
 * fogonazo blanco en cada recarga. Es medio segundo y es exactamente el detalle
 * que hace que una herramienta parezca barata.
 */
applyTheme(readTheme());

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
