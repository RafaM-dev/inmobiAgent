import type {
  AgentToneContract,
  ChannelAccountContract,
  SettingsResponse,
  UpdateAgentSettingsRequest,
  UsageSummary,
} from "@agentinmobi/contracts";
import { Info, Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorNotice, Page, PageHeader } from "@/components/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";

const TONES: readonly { value: AgentToneContract; label: string; hint: string }[] = [
  {
    value: "CERCANO",
    label: "Cercano",
    hint: "Tutea y acompaña. El de una inmobiliaria de barrio.",
  },
  { value: "FORMAL", label: "Formal", hint: "Trata de usted. Alto valor, obra nueva, corporativo." },
  { value: "NEUTRO", label: "Neutro", hint: "Directo y sin adornos." },
];

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;

/** Céntimos incluidos: un turno cuesta millonésimas y redondear lo esconde. */
const money = (usd: number): string =>
  usd.toLocaleString("es-CO", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const channelLabel = (channel: ChannelAccountContract): string =>
  channel.channelType === "CONSOLE" ? "Simulador" : channel.channelType;

/**
 * Configuración del agente.
 *
 * Lo que se toca aquí es NEGOCIO: cómo se llama el asistente, con qué tono
 * habla, en qué horario propone visitas y cuántos intentos fallidos aguanta
 * antes de llamar a una persona. Nada de esto menciona un proveedor de IA, y
 * por eso sobrevive a cambiarlo.
 *
 * Lo que sí depende del proveedor se muestra pero no se edita: el modelo se
 * elige al desplegar. Cambiar el de embeddings desde una pantalla invalidaría
 * en silencio todo lo indexado — los vectores de dos modelos no se pueden
 * comparar, y el resultado no sería "peor": sería sin sentido.
 */
export const SettingsPage = (): ReactNode => {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [channels, setChannels] = useState<ChannelAccountContract[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [draft, setDraft] = useState<UpdateAgentSettingsRequest>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then(setSettings)
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo cargar la configuración");
      });

    api
      .channelAccounts()
      .then((response) => {
        setChannels(response.items);
      })
      .catch(() => {
        // Los canales son informativos: si fallan, la configuración sigue
        // siendo editable. No se convierte en un error de pantalla completa.
      });

    api
      .usage()
      .then(setUsage)
      .catch(() => {
        // Igual que los canales: informativo, no bloqueante.
      });
  }, []);

  if (settings === null) {
    return (
      <Page>
        <ErrorNotice message={error} />
        {error === null && (
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-52 w-full" />
            <Skeleton className="h-52 w-full" />
          </div>
        )}
      </Page>
    );
  }

  const { agent, tenant, runtime, canEdit } = settings;
  /** Lo que se está editando, o lo guardado si nadie ha tocado ese campo. */
  const value = { ...agent, ...draft };
  const hours = value.businessHours ?? { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" };
  const dirty = Object.keys(draft).length > 0;
  const disabled = !canEdit || busy;

  const patch = (changes: UpdateAgentSettingsRequest): void => {
    setDraft((current) => ({ ...current, ...changes }));
  };

  const toggleDay = (day: number): void => {
    const days = hours.days.includes(day)
      ? hours.days.filter((item) => item !== day)
      : [...hours.days, day].sort((a, b) => a - b);
    // Un horario sin días no es un horario: se ignora el clic en vez de
    // enviar algo que el dominio va a rechazar.
    if (days.length === 0) return;
    patch({ businessHours: { ...hours, days } });
  };

  const save = (event: SyntheticEvent): void => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    api
      .updateSettings(draft)
      .then((updated) => {
        setSettings(updated);
        setDraft({});
        toast.success("Configuración guardada. Se aplica desde la siguiente respuesta del agente.");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "No se pudo guardar");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Page className="pb-24">
      <PageHeader title="Configuración del agente" description={tenant.name} />

      <ErrorNotice message={error} />

      {!canEdit && (
        <Alert>
          <Info />
          <AlertDescription>
            Tu rol permite ver la configuración, no cambiarla. Cómo habla el agente afecta a todas
            las conversaciones de la inmobiliaria.
          </AlertDescription>
        </Alert>
      )}

      <form className="space-y-6" onSubmit={save}>
        {/* ------------------------------------------------ cómo se presenta */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cómo se presenta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="agentName">Nombre del asistente</Label>
              <Input
                id="agentName"
                value={value.agentDisplayName}
                maxLength={60}
                disabled={disabled}
                className="max-w-xs"
                onChange={(event) => {
                  patch({ agentDisplayName: event.target.value });
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tone">Tono</Label>
              <Select
                value={value.tone}
                disabled={disabled}
                onValueChange={(tone) => {
                  // Base UI admite deseleccionar (`null`); aquí el tono siempre
                  // tiene un valor, así que un `null` es simplemente un no-op.
                  if (tone !== null) patch({ tone });
                }}
              >
                <SelectTrigger id="tone" className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((tone) => (
                    <SelectItem key={tone.value} value={tone.value}>
                      {tone.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {TONES.find((tone) => tone.value === value.tone)?.hint ?? ""}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="welcome">Mensaje de bienvenida</Label>
              <Textarea
                id="welcome"
                rows={3}
                maxLength={500}
                disabled={disabled}
                value={value.welcomeMessage ?? ""}
                placeholder="Hola, soy el asistente de…"
                onChange={(event) => {
                  patch({ welcomeMessage: event.target.value });
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* --------------------------------------------------------- horario */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Horario de atención</CardTitle>
            <CardDescription>
              Franja en la que el agente propone visitas. Va en la zona horaria de la inmobiliaria
              ({tenant.timezone}), no en la de quien mira la pantalla.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((label, day) => {
                const activo = hours.days.includes(day);
                return (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant={activo ? "default" : "outline"}
                    disabled={disabled}
                    aria-pressed={activo}
                    className="w-12"
                    onClick={() => {
                      toggleDay(day);
                    }}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <Label htmlFor="from">Desde</Label>
                <Input
                  id="from"
                  type="time"
                  className="w-32"
                  disabled={disabled}
                  value={hours.from}
                  onChange={(event) => {
                    patch({ businessHours: { ...hours, from: event.target.value } });
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="to">Hasta</Label>
                <Input
                  id="to"
                  type="time"
                  className="w-32"
                  disabled={disabled}
                  value={hours.to}
                  onChange={(event) => {
                    patch({ businessHours: { ...hours, to: event.target.value } });
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ------------------------------------------------------ escalar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cuándo llamar a una persona</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="failed">Turnos fallidos seguidos antes de escalar</Label>
              <Input
                id="failed"
                type="number"
                min={1}
                max={10}
                className="w-24"
                disabled={disabled}
                value={value.maxConsecutiveFailedTurns}
                onChange={(event) => {
                  patch({ maxConsecutiveFailedTurns: Number(event.target.value) });
                }}
              />
              <p className="text-muted-foreground max-w-lg text-xs">
                Cuanto más bajo, antes entra un asesor. Es la diferencia entre un cliente atendido
                y un cliente peleándose con un bot.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="handoffEmail">Correo de avisos</Label>
              <Input
                id="handoffEmail"
                type="email"
                className="max-w-xs"
                disabled={disabled}
                value={value.handoffEmail ?? ""}
                placeholder="asesores@inmobiliaria.co"
                onChange={(event) => {
                  patch({ handoffEmail: event.target.value });
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* --------------------------------------------------------- gasto */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gasto en IA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {usage !== null && (
              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-heading text-2xl font-semibold tabular-nums">
                    {money(usage.spentUsd)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {usage.limitUsd > 0 ? `de ${money(usage.limitUsd)}` : "sin tope"} ·{" "}
                    {usage.turns} turnos en {usage.period}
                  </span>
                </div>

                {usage.limitUsd > 0 && (
                  <div
                    className="bg-muted h-2 w-full max-w-md overflow-hidden rounded-full"
                    role="progressbar"
                    aria-valuenow={Math.round(usage.ratio * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Consumo del presupuesto mensual"
                  >
                    {/*
                     * A partir del 80 % cambia de color. Es el mismo umbral que
                     * usa la política de gasto en el servidor: si aquí fuera
                     * otro, el panel avisaría cuando el sistema ya bloqueó, o
                     * al revés.
                     */}
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        usage.ratio >= 0.8 ? "bg-warm" : "bg-primary",
                      )}
                      style={{ width: `${String(Math.min(usage.ratio * 100, 100))}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="budget">Tope mensual (USD)</Label>
              <Input
                id="budget"
                type="number"
                min={0}
                step={1}
                className="w-32"
                disabled={disabled}
                value={value.monthlyBudgetUsd ?? 0}
                onChange={(event) => {
                  patch({ monthlyBudgetUsd: Number(event.target.value) });
                }}
              />
              <p className="text-muted-foreground max-w-lg text-xs">
                <strong className="text-foreground">Cero significa sin tope</strong>, no «no gastes
                nada»: a quien se le olvida configurarlo no se le puede apagar el agente. Al
                alcanzarlo, las conversaciones pasan a un asesor en vez de quedarse sin respuesta.
              </p>
            </div>
          </CardContent>
        </Card>

        {/*
         * Barra fija: en una pantalla larga, un botón de guardar al final es un
         * botón que nadie encuentra tras editar el primer campo.
         */}
        {canEdit && dirty && (
          <div className="bg-card/95 fixed inset-x-0 bottom-0 z-10 border-t backdrop-blur md:left-60">
            <div className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-6 py-3">
              <span className="text-muted-foreground mr-auto text-xs">Hay cambios sin guardar.</span>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraft({});
                }}
              >
                Descartar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {busy ? "Guardando…" : "Guardar cambios"}
              </Button>
            </div>
          </div>
        )}
      </form>

      {/* --------------------------------------------------- solo lectura */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cómo está desplegado</CardTitle>
          <CardDescription>
            Solo lectura: se fija al desplegar, no desde aquí. Cambiar el modelo de embeddings sin
            reindexar dejaría la búsqueda comparando vectores de dos espacios distintos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              { label: "Modelo de lenguaje", value: runtime.llmProvider, mono: true },
              { label: "Modelo de embeddings", value: runtime.embeddingProvider, mono: true },
              {
                label: "Modo",
                value: runtime.demoMode
                  ? "Demo — funciona entero sin ninguna clave de API"
                  : "Proveedor externo activo",
                mono: false,
              },
              {
                label: "Zona horaria · moneda",
                value: `${tenant.timezone} · ${tenant.currency}`,
                mono: false,
              },
            ].map((row) => (
              <div key={row.label} className="space-y-0.5">
                <dt className="text-muted-foreground text-xs">{row.label}</dt>
                <dd className={cn("text-sm", row.mono && "font-mono")}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card className={cn(channels.length > 0 && "overflow-hidden pb-0")}>
        <CardHeader>
          <CardTitle className="text-base">Canales conectados</CardTitle>
        </CardHeader>
        <CardContent className={cn(channels.length > 0 && "px-0")}>
          {channels.length === 0 ? (
            <EmptyState title="No hay ningún canal dado de alta" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Canal</TableHead>
                  <TableHead>Cuenta</TableHead>
                  <TableHead>Identificador</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((channel) => (
                  <TableRow key={channel.id}>
                    <TableCell className="font-medium">{channelLabel(channel)}</TableCell>
                    <TableCell>{channel.displayName}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {channel.externalId}
                    </TableCell>
                    <TableCell>
                      <Badge variant={channel.isActive ? "default" : "outline"}>
                        {channel.isActive ? "Activo" : "Desactivado"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Page>
  );
};
