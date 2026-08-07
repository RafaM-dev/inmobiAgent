import type { LoginRequest, SessionResponse } from "@agentinmobi/contracts";
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";

/**
 * Sesión del asesor.
 *
 * No guarda ningún token: la sesión vive en una cookie `httpOnly` que este
 * código no puede leer. Al arrancar se pregunta a `/api/auth/me`, que es la
 * única forma honesta de saber si hay sesión — y de paso comprueba que sigue
 * siendo válida en el servidor, no solo que hay algo guardado en el navegador.
 */

export type SessionState =
  | { readonly status: "loading" }
  | { readonly status: "anonymous" }
  | { readonly status: "authenticated"; readonly session: SessionResponse };

/**
 * Las operaciones se declaran como propiedades de función y no como métodos: al
 * desestructurarlas (`const { login } = useSession()`) un método perdería su
 * `this`, y el linter lo señala con razón.
 */
interface SessionContextValue {
  readonly state: SessionState;
  readonly login: (credentials: LoginRequest) => Promise<void>;
  readonly logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export const SessionProvider = ({ children }: { children: ReactNode }): ReactNode => {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    api
      .me(controller.signal)
      .then((session) => {
        setState({ status: "authenticated", session });
      })
      .catch((error: unknown) => {
        // Un 401 al arrancar es lo normal: todavía no hay sesión.
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.isUnauthorized) {
          setState({ status: "anonymous" });
          return;
        }
        setState({ status: "anonymous" });
      });

    return () => {
      controller.abort();
    };
  }, []);

  const login = useCallback(async (credentials: LoginRequest) => {
    const session = await api.login(credentials);
    setState({ status: "authenticated", session });
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setState({ status: "anonymous" });
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ state, login, logout }),
    [state, login, logout],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
};

export const useSession = (): SessionContextValue => {
  const value = use(SessionContext);
  if (!value) throw new Error("useSession fuera de SessionProvider");
  return value;
};
