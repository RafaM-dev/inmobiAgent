import type { AppointmentSummaryContract } from "@agentinmobi/contracts";
import { ArrowRight, CalendarDays, Check, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { EmptyState, ErrorNotice, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Solicitada",
  CONFIRMED: "Confirmada",
  RESCHEDULED: "Reprogramada",
  CANCELLED: "Cancelada",
  COMPLETED: "Realizada",
  NO_SHOW: "No asistió",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  CONFIRMED: "default",
  REQUESTED: "secondary",
  RESCHEDULED: "secondary",
  COMPLETED: "outline",
  CANCELLED: "destructive",
  NO_SHOW: "destructive",
};

const RANGOS = [7, 30, 90] as const;

/*
 * Qué se puede hacer y desde dónde. Sale de la tabla de transiciones del
 * agregado `Appointment`, y no son la misma lista: una visita ya confirmada
 * todavía se puede cancelar, pero no volver a confirmar.
 *
 * Una cancelada o ya realizada no admite ninguna de las dos, y pintar los
 * botones apagados sería peor que no pintarlos: invita a probar. El servidor
 * rechazaría la operación igualmente — esto solo evita el viaje.
 */
const CONFIRMABLES: readonly string[] = ["REQUESTED", "RESCHEDULED"];
const CANCELABLES: readonly string[] = ["REQUESTED", "CONFIRMED", "RESCHEDULED"];

/**
 * Agenda de visitas.
 *
 * La hora que se muestra es la ETIQUETA que calculó el servidor en la zona
 * horaria de la inmobiliaria, no una fecha reinterpretada por el navegador. Un
 * asesor de viaje no puede ver una hora distinta de la que le dijeron al
 * cliente.
 */
export const AgendaPage = (): ReactNode => {
  const navigate = useNavigate();
  const [items, setItems] = useState<AppointmentSummaryContract[]>([]);
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);
  /** Solo la fila con una llamada en vuelo se bloquea, no la agenda entera. */
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api
      .appointments({ days })
      .then((response) => {
        setItems(response.items);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo cargar la agenda");
      });
  }, [days]);

  /**
   * Confirmar y cancelar comparten todo salvo la llamada y el mensaje.
   *
   * La respuesta trae solo lo que cambia —estado, hora y etiqueta—, así que se
   * parchea la fila con eso. Recargar la agenda entera reordenaría la lista bajo
   * el cursor de quien acaba de pulsar, que es la forma más rápida de que
   * alguien confirme la visita equivocada.
   */
  const act = (
    appointment: AppointmentSummaryContract,
    accion: "confirm" | "cancel",
  ): void => {
    setBusyId(appointment.id);
    setError(null);

    const llamada =
      accion === "confirm"
        ? api.confirmAppointment(appointment.id)
        : api.cancelAppointment(appointment.id);

    llamada
      .then((updated) => {
        setItems((current) =>
          current.map((row) =>
            row.id === updated.id
              ? {
                  ...row,
                  status: updated.status,
                  scheduledAt: updated.scheduledAt,
                  label: updated.label,
                }
              : row,
          ),
        );
        toast.success(accion === "confirm" ? "Visita confirmada." : "Visita cancelada.");
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiError
            ? cause.message
            : accion === "confirm"
              ? "No se pudo confirmar la visita"
              : "No se pudo cancelar la visita",
        );
      })
      .finally(() => {
        setBusyId(null);
      });
  };

  return (
    <Page>
      <PageHeader
        title="Agenda"
        description="Las horas van en la zona horaria de la inmobiliaria, no en la de quien mira la pantalla."
      >
        <Badge variant="secondary">{items.length} visitas</Badge>
      </PageHeader>

      <Tabs
        value={String(days)}
        onValueChange={(value) => {
          setDays(Number(value));
        }}
      >
        <TabsList>
          {RANGOS.map((option) => (
            <TabsTrigger key={option} value={String(option)}>
              {option} días
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <ErrorNotice message={error} />

      {items.length === 0 && error === null ? (
        <EmptyState
          icon={CalendarDays}
          title="No hay visitas en este periodo"
          hint="El agente agenda por su cuenta cuando un cliente lo pide: las franjas salen del horario configurado, no las escribe el modelo."
        />
      ) : (
        items.length > 0 && (
          <Card className="overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cuándo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Inmueble</TableHead>
                  <TableHead className="text-right">Duración</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((appointment) => (
                  <TableRow key={appointment.id}>
                    <TableCell className="font-medium">{appointment.label}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[appointment.status] ?? "outline"}>
                        {STATUS_LABEL[appointment.status] ?? appointment.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {appointment.propertyRef ?? "Por definir"}
                    </TableCell>
                    <TableCell className="text-right">{appointment.durationMin} min</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {CONFIRMABLES.includes(appointment.status) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busyId === appointment.id}
                            onClick={() => {
                              act(appointment, "confirm");
                            }}
                          >
                            <Check className="size-4" />
                            Confirmar
                          </Button>
                        )}
                        {CANCELABLES.includes(appointment.status) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busyId === appointment.id}
                            onClick={() => {
                              act(appointment, "cancel");
                            }}
                          >
                            <X className="size-4" />
                            Cancelar
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            void navigate(`/inbox/${appointment.conversationId}`);
                          }}
                        >
                          Ver conversación
                          <ArrowRight className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )
      )}
    </Page>
  );
};
