import type { AppointmentSummaryContract } from "@agentinmobi/contracts";
import { ArrowRight, CalendarDays } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
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
