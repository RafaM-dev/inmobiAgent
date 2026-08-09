import type { ConnectChannelResponse } from "@agentinmobi/contracts";
import { Loader2, TriangleAlert } from "lucide-react";
import { useState, type ReactNode, type SyntheticEvent } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";

interface Props {
  /** Se llama tras conectar, para que la lista de canales se refresque. */
  readonly onConnected: () => void;
}

const EMPTY = { displayName: "", phoneNumberId: "", accessToken: "" };

/**
 * Alta de un número de WhatsApp desde el panel.
 *
 * Hasta ahora conectar una línea era ejecutar un comando en el servidor, que es
 * tanto como decir que solo nosotros podíamos hacerlo. Un producto que se vende
 * a cientos de inmobiliarias no puede tener su paso de puesta en marcha
 * únicamente en una terminal.
 *
 * **El token no vuelve nunca.** Se cifra al guardarlo y ni esta pantalla ni
 * ninguna otra lo leen de vuelta; por eso el campo se vacía al cerrar y por eso
 * no se precarga al reconectar. Cambiarlo es volver a pegarlo entero.
 */
export const ConnectWhatsApp = ({ onConnected }: Props): ReactNode => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Se conectó, pero el proveedor no lo confirmó. Sobrevive al diálogo. */
  const [unverified, setUnverified] = useState<ConnectChannelResponse | null>(null);

  const complete =
    form.displayName.trim() !== "" &&
    form.phoneNumberId.trim() !== "" &&
    form.accessToken.trim() !== "";

  const close = (): void => {
    setOpen(false);
    // El token no se queda en memoria más de lo necesario.
    setForm(EMPTY);
    setError(null);
  };

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (!complete || busy) return;

    setBusy(true);
    setError(null);

    api
      .connectWhatsApp(form)
      .then((response) => {
        close();
        setUnverified(response.verified ? null : response);
        onConnected();

        if (response.verified) {
          toast.success(`${response.account.displayName} está conectado y responde.`);
        } else {
          toast.warning("Guardado, pero WhatsApp no lo confirmó. Revisa el aviso.");
        }
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo conectar el número");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const field = (key: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        Conectar WhatsApp
      </Button>

      {/*
       * El aviso vive FUERA del diálogo a propósito: si se cerrara con él,
       * quien conecta un número con un token equivocado vería un instante de
       * texto y se quedaría creyendo que quedó funcionando.
       */}
      {unverified !== null && (
        <Alert variant="destructive" className="mt-4">
          <TriangleAlert />
          <AlertTitle>
            {unverified.account.displayName} quedó guardado, pero sin confirmar
          </AlertTitle>
          <AlertDescription>
            <p>
              WhatsApp no confirmó que el token sirva para este número:{" "}
              <span className="font-medium">
                {unverified.verificationMessage ?? "no se obtuvo respuesta"}
              </span>
            </p>
            <p>
              Si el token es correcto, puede tratarse de una caída momentánea y el número funcione
              igualmente. Si no lo es, los mensajes de los clientes entrarán pero el agente no
              podrá responderles. Vuelve a conectarlo con el token correcto para salir de dudas.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent>
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Conectar un número de WhatsApp</DialogTitle>
              <DialogDescription>
                Hacen falta dos datos de la cuenta de WhatsApp Business de la inmobiliaria: el
                identificador del número y un token de acceso con permiso para enviar en su
                nombre.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="wa-name">Nombre de la línea</Label>
                <Input
                  id="wa-name"
                  value={form.displayName}
                  maxLength={60}
                  disabled={busy}
                  placeholder="Comercial Bogotá"
                  onChange={field("displayName")}
                />
                <p className="text-muted-foreground text-xs">
                  Solo para identificarla en este panel. No lo ve ningún cliente.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="wa-id">Identificador del número</Label>
                <Input
                  id="wa-id"
                  value={form.phoneNumberId}
                  maxLength={120}
                  disabled={busy}
                  className="font-mono"
                  autoComplete="off"
                  onChange={field("phoneNumberId")}
                />
                <p className="text-muted-foreground text-xs">
                  El <span className="font-mono">phone number ID</span>, no el número de teléfono.
                  Es lo que identifica esta línea en los mensajes que entran.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="wa-token">Token de acceso</Label>
                <Input
                  id="wa-token"
                  type="password"
                  value={form.accessToken}
                  maxLength={2000}
                  disabled={busy}
                  autoComplete="off"
                  onChange={field("accessToken")}
                />
                <p className="text-muted-foreground text-xs">
                  Se guarda cifrado y no se vuelve a mostrar. Para cambiarlo habrá que pegarlo de
                  nuevo.
                </p>
              </div>

              {error !== null && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="outline">
                    Cancelar
                  </Button>
                }
              />
              <Button type="submit" disabled={!complete || busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {busy ? "Comprobando…" : "Conectar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
