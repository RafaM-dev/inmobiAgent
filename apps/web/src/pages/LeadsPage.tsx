import type { LeadSummaryContract } from "@agentinmobi/contracts";
import { ArrowRight, Users } from "lucide-react";
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
 * Bandeja de leads.
 *
 * Ordenada por puntuación, que es la pregunta que un asesor se hace al abrirla:
 * a quién llamo ahora. Cada fila lleva al hilo de su conversación, porque lo
 * primero que se quiere ver antes de llamar es qué se dijo.
 */
export const LeadsPage = (): ReactNode => {
  const navigate = useNavigate();
  const [items, setItems] = useState<LeadSummaryContract[]>([]);
  const [band, setBand] = useState("");
  const [error, setError] = useState<string | null>(null);

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
                {items.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell>
                      <Badge className={cn("tabular-nums", BAND_CLASS[lead.band])}>
                        {lead.score} · {BAND_LABEL[lead.band] ?? lead.band}
                      </Badge>
                    </TableCell>
                    <TableCell>{STATUS_LABEL[lead.status] ?? lead.status}</TableCell>
                    <TableCell className="text-right">{lead.interestCount}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {lead.assignedUserId === undefined ? "Sin asignar" : "Asignado"}
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
                ))}
              </TableBody>
            </Table>
          </Card>
        )
      )}
    </Page>
  );
};
