import { AlertCircle, CheckCircle2, Loader2, MessagesSquare } from "lucide-react";
import { useState, type ReactNode, type SyntheticEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";

const MIN_LENGTH = 10;

interface Props {
  /** Cambia solo el texto. La operación es exactamente la misma. */
  readonly mode: "invitation" | "reset";
}

/**
 * Elegir contraseña con un enlace de un solo uso.
 *
 * Una sola pantalla para aceptar una invitación y para restablecer la
 * contraseña porque son la misma operación; lo único que cambia es de dónde
 * venía el enlace, y eso solo afecta a las palabras.
 *
 * Al terminar NO se entra automáticamente: sería cómodo, pero significaría que
 * quien tenga el enlace entra sin escribir jamás la contraseña — y ese enlace
 * ha viajado por correo. Se pide escribirla una vez, en la pantalla de acceso.
 */
export const RedeemPage = ({ mode }: Props): ReactNode => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const tenantSlug = params.get("inmobiliaria") ?? "";

  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ email: string; tenantSlug: string } | null>(null);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = repeat.length > 0 && password !== repeat;
  const ready = password.length >= MIN_LENGTH && password === repeat && token !== "";

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (!ready || busy) return;

    setBusy(true);
    setError(null);

    api
      .redeemToken({ token, password })
      .then((result) => {
        setDone(result);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo guardar la contraseña");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const title = mode === "invitation" ? "Elige tu contraseña" : "Nueva contraseña";

  return (
    <main className="bg-muted/40 relative grid min-h-screen place-items-center p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="bg-primary text-primary-foreground grid size-10 place-items-center rounded-lg">
            <MessagesSquare className="size-5" />
          </div>
          <h1 className="font-heading text-lg font-semibold tracking-tight">AgentInmobi</h1>
        </div>

        {done !== null ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="text-primary size-5" />
                Contraseña guardada
              </CardTitle>
              <CardDescription>
                Ya puedes entrar con <span className="font-medium">{done.email}</span>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                onClick={() => {
                  void navigate("/");
                }}
              >
                Ir al acceso
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription>
                {mode === "invitation"
                  ? "Te han dado acceso al panel. Elige una contraseña para entrar."
                  : "Escribe una contraseña nueva para tu cuenta."}
                {tenantSlug !== "" && (
                  <>
                    {" "}
                    Inmobiliaria: <span className="font-mono">{tenantSlug}</span>.
                  </>
                )}
              </CardDescription>
            </CardHeader>

            <CardContent>
              {token === "" ? (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertDescription>
                    Este enlace está incompleto. Ábrelo tal cual llegó en el correo, sin cortarlo.
                  </AlertDescription>
                </Alert>
              ) : (
                <form className="space-y-4" onSubmit={submit}>
                  <div className="space-y-2">
                    <Label htmlFor="password">Contraseña</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      autoComplete="new-password"
                      disabled={busy}
                      onChange={(event) => {
                        setPassword(event.target.value);
                      }}
                    />
                    <p className="text-muted-foreground text-xs">
                      Mínimo {MIN_LENGTH} caracteres. La longitud protege más que mezclar símbolos:
                      tres palabras que recuerdes valen más que <span className="font-mono">P4s$w</span>.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="repeat">Repítela</Label>
                    <Input
                      id="repeat"
                      type="password"
                      value={repeat}
                      autoComplete="new-password"
                      disabled={busy}
                      onChange={(event) => {
                        setRepeat(event.target.value);
                      }}
                    />
                  </div>

                  {/* Los avisos de forma se dan mientras se escribe, no al enviar. */}
                  {tooShort && (
                    <p className="text-destructive text-xs">
                      Te faltan {MIN_LENGTH - password.length} caracteres.
                    </p>
                  )}
                  {mismatch && <p className="text-destructive text-xs">Las dos no coinciden.</p>}

                  {error !== null && (
                    <Alert variant="destructive">
                      <AlertCircle />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <Button type="submit" className="w-full" disabled={!ready || busy}>
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    {busy ? "Guardando…" : "Guardar contraseña"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
};
