import { AlertCircle, Loader2, MessagesSquare } from "lucide-react";
import { useState, type ReactNode, type SyntheticEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
 * mismo para "no existe" y "contraseña incorrecta": distinguirlos permitiría
 * averiguar qué correos están dados de alta.
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
    <main className="bg-muted/40 grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="bg-primary text-primary-foreground grid size-10 place-items-center rounded-lg">
            <MessagesSquare className="size-5" />
          </div>
          <h1 className="font-heading text-lg font-semibold tracking-tight">AgentInmobi</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Panel de la inmobiliaria</CardTitle>
            <CardDescription>Entra con la cuenta de tu inmobiliaria.</CardDescription>
          </CardHeader>

          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="tenantSlug">Inmobiliaria</Label>
                <Input
                  id="tenantSlug"
                  value={tenantSlug}
                  autoComplete="organization"
                  required
                  onChange={(event) => {
                    setTenantSlug(event.target.value);
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Correo</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  autoComplete="username"
                  required
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  required
                  onChange={(event) => {
                    setPassword(event.target.value);
                  }}
                />
              </div>

              {error !== null && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {busy ? "Entrando…" : "Entrar"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};
