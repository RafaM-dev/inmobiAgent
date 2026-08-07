import { useState, type ReactNode, type SyntheticEvent } from "react";
import { ApiError } from "../api/client";
import { useSession } from "../auth/session-context";

/**
 * Pantalla de acceso.
 *
 * Pide el identificador de la inmobiliaria además del correo porque la misma
 * persona puede trabajar para dos: sin él, el sistema tendría que adivinar, y
 * adivinar en autenticación siempre acaba mal.
 *
 * El mensaje de error es el que devuelve la API, que es deliberadamente el
 * mismo para "no existe" y "contraseña incorrecta".
 */
export const LoginPage = (): ReactNode => {
  const { login } = useSession();
  const [tenantSlug, setTenantSlug] = useState("inmobiliaria-demo");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    login({ tenantSlug, email, password })
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiError ? cause.message : "No se pudo conectar con el servidor",
        );
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <main className="login">
      <form className="login__card" onSubmit={submit}>
        <h1 className="login__brand">AgentInmobi</h1>
        <p className="login__subtitle">Panel de la inmobiliaria</p>

        <label className="field">
          <span>Inmobiliaria</span>
          <input
            value={tenantSlug}
            onChange={(event) => {
              setTenantSlug(event.target.value);
            }}
            autoComplete="organization"
            required
          />
        </label>

        <label className="field">
          <span>Correo</span>
          <input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            autoComplete="username"
            required
          />
        </label>

        <label className="field">
          <span>Contraseña</span>
          <input
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            autoComplete="current-password"
            required
          />
        </label>

        {error !== null && <p className="login__error">{error}</p>}

        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
};
