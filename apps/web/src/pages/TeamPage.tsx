import type { TeamMember, UserRole } from "@agentinmobi/contracts";
import { Copy, Info, Loader2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorNotice, Page, PageHeader } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";
import { useSession } from "../auth/session-context";

const ROLES: readonly { value: UserRole; label: string; hint: string }[] = [
  { value: "ADMIN", label: "Administrador", hint: "Todo, salvo tocar al propietario." },
  { value: "AGENT", label: "Asesor", hint: "Atiende conversaciones y lleva sus leads." },
  { value: "VIEWER", label: "Solo lectura", hint: "Mira, no toca. Para dirección o auditoría." },
];

const ROLE_LABEL: Record<UserRole, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  AGENT: "Asesor",
  VIEWER: "Solo lectura",
};

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  ACTIVE: { label: "Activo", variant: "default" },
  INVITED: { label: "Invitado", variant: "secondary" },
  DISABLED: { label: "Desactivado", variant: "outline" },
};

const EMPTY = { email: "", displayName: "", role: "AGENT" as UserRole };

/**
 * El equipo de la inmobiliaria.
 *
 * Hasta ahora dar de alta a un asesor era un comando en el servidor, y eso
 * significaba que solo nosotros podíamos hacerlo. Aquí lo hace la inmobiliaria.
 *
 * Verlo lo puede cualquiera con sesión —hace falta para saber a quién asignar
 * un lead—; cambiarlo, solo propietario y administradores. Los botones que no
 * corresponden no se pintan, pero la decisión de verdad la toma el servidor:
 * el navegador no es una frontera de seguridad.
 */
export const TeamPage = (): ReactNode => {
  const { state } = useSession();
  const myId = state.status === "authenticated" ? state.session.user.userId : "";

  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  /** Invitación creada cuyo correo no salió: hay que pasar el enlace a mano. */
  const [manual, setManual] = useState<{ email: string; url: string } | null>(null);

  const load = useCallback(() => {
    api
      .team()
      .then((response) => {
        setMembers(response.items);
        setCanManage(response.canManage);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo cargar el equipo");
      });
  }, []);

  useEffect(load, [load]);

  const complete = form.email.trim() !== "" && form.displayName.trim() !== "";

  const invite = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (!complete || busy) return;

    setBusy(true);
    setFormError(null);

    api
      .inviteUser(form)
      .then((response) => {
        setOpen(false);
        setForm(EMPTY);
        load();

        if (response.delivered) {
          toast.success(`Invitación enviada a ${response.user.email}.`);
        } else {
          // Sin correo configurado el enlace no ha salido de la máquina. Callar
          // dejaría una invitación que nadie puede aceptar.
          setManual({ email: response.user.email, url: response.url ?? "" });
          toast.warning("Invitación creada, pero el correo no salió. Pásale el enlace tú.");
        }
      })
      .catch((cause: unknown) => {
        setFormError(cause instanceof ApiError ? cause.message : "No se pudo invitar");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const update = (member: TeamMember, changes: { role?: UserRole; status?: "ACTIVE" | "DISABLED" }) => {
    setBusy(true);
    setError(null);

    api
      .updateTeamMember(member.id, changes)
      .then(() => {
        toast.success(`${member.displayName} actualizado.`);
        load();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo aplicar el cambio");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if (members === null) {
    return (
      <Page>
        <ErrorNotice message={error} />
        {error === null && <Skeleton className="h-64 w-full" />}
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Equipo"
        description="Quién tiene acceso al panel y qué puede hacer cada uno."
      />

      <ErrorNotice message={error} />

      {manual !== null && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Pásale este enlace a {manual.email}</AlertTitle>
          <AlertDescription>
            <p>
              Este despliegue no tiene correo configurado, así que la invitación no se ha enviado.
              El enlace es válido durante 7 días y solo sirve una vez.
            </p>
            <div className="flex w-full items-center gap-2">
              <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-xs">
                {manual.url}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(manual.url);
                  toast.success("Enlace copiado.");
                }}
              >
                <Copy className="size-3.5" />
                Copiar
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {!canManage && (
        <Alert>
          <Info />
          <AlertDescription>
            Tu rol permite ver quién está en el equipo, no cambiarlo.
          </AlertDescription>
        </Alert>
      )}

      <Card className={members.length > 0 ? "overflow-hidden pb-0" : undefined}>
        <CardHeader>
          <CardTitle className="text-base">
            {members.length} {members.length === 1 ? "persona" : "personas"}
          </CardTitle>
          {canManage && (
            <CardAction>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setOpen(true);
                }}
              >
                Invitar
              </Button>
            </CardAction>
          )}
        </CardHeader>

        <CardContent className={members.length > 0 ? "px-0" : undefined}>
          {members.length === 0 ? (
            <EmptyState title="Todavía no hay nadie" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                  {canManage && <TableHead className="text-right">Acciones</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const soyYo = member.id === myId;
                  // El propietario no se toca desde aquí, y nadie se toca a sí
                  // mismo: si no, la última persona con acceso podría cerrarse
                  // la puerta y haría falta la consola para abrirla.
                  const editable = canManage && !soyYo && member.role !== "OWNER";

                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="font-medium">
                          {member.displayName}
                          {soyYo && <span className="text-muted-foreground"> · tú</span>}
                        </div>
                        <div className="text-muted-foreground text-xs">{member.email}</div>
                      </TableCell>

                      <TableCell>
                        {editable ? (
                          <Select
                            value={member.role}
                            disabled={busy}
                            onValueChange={(role) => {
                              if (role !== null && role !== member.role) {
                                update(member, { role: role });
                              }
                            }}
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLES.map((role) => (
                                <SelectItem key={role.value} value={role.value}>
                                  {role.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-sm">{ROLE_LABEL[member.role]}</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge variant={STATUS[member.status]?.variant ?? "outline"}>
                          {STATUS[member.status]?.label ?? member.status}
                        </Badge>
                      </TableCell>

                      {canManage && (
                        <TableCell className="text-right">
                          {editable && (
                            <Button
                              size="sm"
                              variant={member.status === "DISABLED" ? "outline" : "ghost"}
                              disabled={busy}
                              onClick={() => {
                                update(member, {
                                  status: member.status === "DISABLED" ? "ACTIVE" : "DISABLED",
                                });
                              }}
                            >
                              {member.status === "DISABLED" ? "Reactivar" : "Desactivar"}
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setOpen(false);
            setForm(EMPTY);
            setFormError(null);
          }
        }}
      >
        <DialogContent>
          <form onSubmit={invite}>
            <DialogHeader>
              <DialogTitle>Invitar a alguien</DialogTitle>
              <DialogDescription>
                Recibirá un enlace para elegir su contraseña. Hasta que lo use, no puede entrar.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre</Label>
                <Input
                  id="nombre"
                  value={form.displayName}
                  maxLength={120}
                  disabled={busy}
                  placeholder="María Restrepo"
                  onChange={(event) => {
                    setForm((current) => ({ ...current, displayName: event.target.value }));
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="correo">Correo</Label>
                <Input
                  id="correo"
                  type="email"
                  value={form.email}
                  maxLength={200}
                  disabled={busy}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, email: event.target.value }));
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="rol">Rol</Label>
                <Select
                  value={form.role}
                  disabled={busy}
                  onValueChange={(role) => {
                    if (role !== null) setForm((current) => ({ ...current, role: role }));
                  }}
                >
                  <SelectTrigger id="rol">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {ROLES.find((role) => role.value === form.role)?.hint ?? ""}
                </p>
              </div>

              {formError !== null && (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
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
                {busy ? "Invitando…" : "Enviar invitación"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Page>
  );
};
