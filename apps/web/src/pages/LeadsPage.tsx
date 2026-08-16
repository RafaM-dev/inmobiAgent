import type { LeadStatusContract, LeadSummaryContract, TeamMember } from "@agentinmobi/contracts";
import { ArrowRight, Loader2, Users } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { EmptyState, ErrorNotice, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";

const STATUS_LABEL: Record<string, string> = {
  NEW: "Nuevo",
  CONTACTED: "Contactado",
  QUALIFIED: "Cualificado",
  SCHEDULED: "Con visita",
  WON: "Ganado",
  LOST: "Perdido",
};

const BAND_LABEL: Record<string, string> = { HOT: "Caliente", WARM: "Tibio", COLD: "Frío" };

/**
 * La temperatura se ve, no se lee.
 *
 * Son tokens del sistema (`--hot`, `--warm`, `--cold`), no colores sueltos: el
 * mismo rojo significa lo mismo aquí, en el inbox y en cualquier panel futuro.
 */
const BAND_CLASS: Record<string, string> = {
  HOT: "bg-hot text-hot-foreground border-transparent",
  WARM: "bg-warm text-warm-foreground border-transparent",
  COLD: "bg-cold text-cold-foreground border-transparent",
};

const FILTERS = [
  { key: "", label: "Todos" },
  { key: "HOT", label: "Calientes" },
  { key: "WARM", label: "Tibios" },
] as const;

/**
 * Estados de los que ya no se vuelve.
 *
 * El agregado no ofrece ninguna transición desde `WON` ni desde `LOST` —reabrir
 * un lead es crear uno nuevo—, así que estos dos se piden por diálogo. No es
 * ceremonia: es que un clic accidental en un desplegable no debería cerrar una
 * operación sin vuelta atrás, y de paso es el único momento en que alguien va a
 * escribir POR QUÉ se perdió, que es el dato que nadie tiene seis meses después.
 */
const TERMINAL: readonly string[] = ["WON", "LOST"];

/** Valor del desplegable para "nadie". Un `Select` no admite `null` como valor. */
const NADIE = "__nadie__";

/**
 * Bandeja de leads.
 *
 * Ordenada por puntuación, que es la pregunta que un asesor se hace al abrirla:
 * a quién llamo ahora. Cada fila lleva al hilo de su conversación, porque lo
 * primero que se quiere ver antes de llamar es qué se dijo.
 *
 * Los estados que ofrece cada desplegable NO están escritos aquí: llegan en
 * `allowedTransitions` con cada lead. El embudo es una regla de negocio y vive
 * en el servidor; el panel solo pinta lo que le dicen que es posible.
 */
export const LeadsPage = (): ReactNode => {
  const navigate = useNavigate();
  const [items, setItems] = useState<LeadSummaryContract[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [band, setBand] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Identificador del lead que tiene una llamada en vuelo, para bloquear solo esa fila. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const [closing, setClosing] = useState<{
    lead: LeadSummaryContract;
    status: LeadStatusContract;
  } | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    api
      .leads(band !== "" ? { band } : {})
      .then((response) => {
        setItems(response.items);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudieron cargar los leads");
      });
  }, [band]);

  /*
   * El equipo se pide una vez y aparte de los leads.
   *
   * Sirve para dos cosas distintas: poblar el desplegable de asignación y
   * traducir el identificador guardado en un nombre. Sin esto la columna decía
   * literalmente "Asignado", que es la información justa para no servir de nada
   * —un asesor necesita saber si es SUYO, no que alguien lo tiene—.
   *
   * Si falla, no se rompe la pantalla: los leads son lo importante y se pueden
   * seguir moviendo por el embudo sin poder reasignarlos.
   */
  useEffect(() => {
    api
      .team()
      .then((response) => {
        setTeam(response.items.filter((member) => member.status === "ACTIVE"));
      })
      .catch(() => {
        setTeam([]);
      });
  }, []);

  const nameOf = useCallback(
    (userId: string): string => team.find((member) => member.id === userId)?.displayName ?? "Alguien del equipo",
    [team],
  );

  /** Sustituye la fila con lo que devolvió el servidor. Nada de adivinar el resultado. */
  const replace = (updated: LeadSummaryContract): void => {
    setItems((current) => current.map((lead) => (lead.id === updated.id ? updated : lead)));
  };

  const move = (lead: LeadSummaryContract, status: LeadStatusContract, motivo?: string): void => {
    setBusyId(lead.id);
    setError(null);

    api
      .changeLeadStatus(lead.id, {
        status,
        ...(motivo !== undefined && motivo.trim() !== "" ? { reason: motivo.trim() } : {}),
      })
      .then((updated) => {
        replace(updated);
        setClosing(null);
        setReason("");
        toast.success(`Lead marcado como "${STATUS_LABEL[status] ?? status}".`);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo cambiar el estado");
      })
      .finally(() => {
        setBusyId(null);
      });
  };

  const assign = (lead: LeadSummaryContract, value: string): void => {
    const userId = value === NADIE ? null : value;
    if (userId === (lead.assignedUserId ?? null)) return;

    setBusyId(lead.id);
    setError(null);

    api
      .assignLead(lead.id, { userId })
      .then((updated) => {
        replace(updated);
        toast.success(userId === null ? "Lead sin asignar." : `Asignado a ${nameOf(userId)}.`);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo asignar el lead");
      })
      .finally(() => {
        setBusyId(null);
      });
  };

  const confirmClose = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (closing === null || busyId !== null) return;
    move(closing.lead, closing.status, reason);
  };

  return (
    <Page>
      <PageHeader
        title="Leads"
        description="Ordenados por puntuación: arriba está a quién llamar ahora."
      >
        <Badge variant="secondary">{items.length}</Badge>
      </PageHeader>

      <Tabs
        value={band}
        onValueChange={(value) => {
          setBand(String(value));
        }}
      >
        <TabsList>
          {FILTERS.map((filter) => (
            <TabsTrigger key={filter.key} value={filter.key}>
              {filter.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <ErrorNotice message={error} />

      {items.length === 0 && error === null ? (
        <EmptyState
          icon={Users}
          title="Todavía no hay leads"
          hint="Se crean solos: en cuanto el agente le enseña un inmueble a alguien, aparece aquí sin que nadie lo registre."
        />
      ) : (
        items.length > 0 && (
          <Card className="overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Puntuación</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Inmuebles vistos</TableHead>
                  <TableHead>Asignado</TableHead>
                  <TableHead>Última actividad</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((lead) => {
                  const busy = busyId === lead.id;
                  const cerrado = lead.allowedTransitions.length === 0;

                  return (
                    <TableRow key={lead.id}>
                      <TableCell>
                        <Badge className={cn("tabular-nums", BAND_CLASS[lead.band])}>
                          {lead.score} · {BAND_LABEL[lead.band] ?? lead.band}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        {cerrado ? (
                          // Sin transiciones posibles no se pinta un desplegable
                          // vacío: se dice en qué acabó y se acabó.
                          <span className="text-sm">{STATUS_LABEL[lead.status] ?? lead.status}</span>
                        ) : (
                          <Select
                            value={lead.status}
                            disabled={busy}
                            onValueChange={(next) => {
                              if (next === null || next === lead.status) return;
                              const status: LeadStatusContract = next;

                              if (TERMINAL.includes(status)) {
                                setReason("");
                                setClosing({ lead, status });
                                return;
                              }
                              move(lead, status);
                            }}
                          >
                            <SelectTrigger className="w-40" aria-label="Estado del lead">
                              <SelectValue>{STATUS_LABEL[lead.status] ?? lead.status}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {/* El actual, para que el desplegable muestre dónde
                                  está; deshabilitado porque no es un cambio. */}
                              <SelectItem value={lead.status} disabled>
                                {STATUS_LABEL[lead.status] ?? lead.status}
                              </SelectItem>
                              {lead.allowedTransitions.map((status) => (
                                <SelectItem key={status} value={status}>
                                  {STATUS_LABEL[status] ?? status}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>

                      <TableCell className="text-right">{lead.interestCount}</TableCell>

                      <TableCell>
                        {team.length === 0 ? (
                          <span className="text-muted-foreground text-sm">
                            {lead.assignedUserId === undefined ? "Sin asignar" : "Asignado"}
                          </span>
                        ) : (
                          <Select
                            value={lead.assignedUserId ?? NADIE}
                            disabled={busy}
                            onValueChange={(value) => {
                              if (value !== null) assign(lead, value);
                            }}
                          >
                            <SelectTrigger className="w-44" aria-label="Asignar lead">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NADIE}>Sin asignar</SelectItem>
                              {team.map((member) => (
                                <SelectItem key={member.id} value={member.id}>
                                  {member.displayName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>

                      <TableCell className="text-muted-foreground">
                        {new Date(lead.lastActivityAt).toLocaleString("es-CO", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>

                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            void navigate(`/inbox/${lead.conversationId}`);
                          }}
                        >
                          Ver conversación
                          <ArrowRight className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )
      )}

      <Dialog
        open={closing !== null}
        onOpenChange={(next) => {
          if (!next) {
            setClosing(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <form onSubmit={confirmClose}>
            <DialogHeader>
              <DialogTitle>
                {closing?.status === "WON" ? "Marcar como ganado" : "Marcar como perdido"}
              </DialogTitle>
              <DialogDescription>
                No tiene vuelta atrás: un lead cerrado no se reabre, se crea uno nuevo. Deja de
                aparecer en la bandeja de trabajo, pero su histórico se conserva entero.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-4">
              <Label htmlFor="motivo">Motivo (opcional)</Label>
              <Textarea
                id="motivo"
                value={reason}
                maxLength={280}
                rows={3}
                placeholder={
                  closing?.status === "WON"
                    ? "Firmó el arriendo del apartamento de Laureles."
                    : "Se fue con otra inmobiliaria; el crédito no le salió."
                }
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
              <p className="text-muted-foreground text-xs">
                Queda en el histórico del lead. Es lo que se lee dentro de seis meses al
                preguntarse qué pasó con esta operación.
              </p>
            </div>

            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="outline">
                    Cancelar
                  </Button>
                }
              />
              <Button
                type="submit"
                variant={closing?.status === "LOST" ? "destructive" : "default"}
                disabled={busyId !== null}
              >
                {busyId !== null && <Loader2 className="size-4 animate-spin" />}
                {closing?.status === "WON" ? "Marcar ganado" : "Marcar perdido"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Page>
  );
};
