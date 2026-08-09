import { AlertCircle, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * Piezas que se repiten en todas las pantallas del panel.
 *
 * Existen para que «cargando», «vacío» y «falló» se vean igual en los siete
 * sitios donde ocurren. Cuando cada pantalla se inventa su propio estado vacío,
 * el asesor no aprende a leerlos: tiene que descifrar cada uno.
 */

export const PageHeader = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  /** Acciones de la pantalla, alineadas a la derecha. */
  children?: ReactNode;
}): ReactNode => (
  <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
    <div className="space-y-1">
      <h1 className="font-heading text-xl font-semibold tracking-tight">{title}</h1>
      {description !== undefined && (
        <p className="text-muted-foreground max-w-2xl text-sm">{description}</p>
      )}
    </div>
    {children !== undefined && <div className="flex items-center gap-2">{children}</div>}
  </header>
);

/** Contenedor con el ancho y el aire de una pantalla del panel. */
export const Page = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode => (
  <div className={cn("mx-auto w-full max-w-6xl space-y-6 p-6", className)}>{children}</div>
);

/**
 * Estado vacío.
 *
 * Con explicación, no solo «sin datos». Un asesor que abre la agenda y no ve
 * nada necesita saber si es que no hay visitas o si algo falló.
 */
export const EmptyState = ({
  title,
  hint,
  icon: Icon = Inbox,
  children,
}: {
  title: string;
  hint?: string;
  icon?: typeof Inbox;
  children?: ReactNode;
}): ReactNode => (
  <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center">
    <Icon className="text-muted-foreground/60 size-7" />
    <div className="space-y-1">
      <p className="text-sm font-medium">{title}</p>
      {hint !== undefined && (
        <p className="text-muted-foreground mx-auto max-w-md text-sm">{hint}</p>
      )}
    </div>
    {children}
  </div>
);

/** Error de pantalla. `null` no pinta nada: se usa directamente con el estado. */
export const ErrorNotice = ({ message }: { message: string | null }): ReactNode =>
  message === null ? null : (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
