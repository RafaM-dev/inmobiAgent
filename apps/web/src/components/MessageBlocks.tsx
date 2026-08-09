import type { PropertyCard, ReplyBlockContract } from "@agentinmobi/contracts";
import { ExternalLink, ImageIcon, MapPin, UserRoundCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Pinta los bloques de un mensaje.
 *
 * El asesor tiene que ver EXACTAMENTE lo que vio el cliente: las mismas fichas
 * con los mismos precios, los mismos botones. Por eso el back-office recibe
 * bloques y no HTML ni texto plano — es el mismo contrato que sale por WhatsApp,
 * pintado con otro estilo.
 *
 * **Los precios se pintan tal cual llegan.** Ni se reformatean, ni se
 * redondean, ni se convierten: el backend ya los puso en la moneda de la
 * inmobiliaria y cualquier transformación aquí sería una cifra distinta de la
 * que vio el cliente.
 *
 * El `switch` es exhaustivo y el tipo lo obliga: si mañana aparece un tipo de
 * bloque nuevo, este archivo deja de compilar en vez de mostrar un hueco.
 */

const Card = ({ card }: { card: PropertyCard }): ReactNode => (
  <div className="bg-card mt-1.5 max-w-sm space-y-1 rounded-md border p-2.5 first:mt-0">
    <div className="text-sm leading-snug font-medium">{card.title}</div>

    {card.price !== undefined && (
      <div className="text-primary text-sm font-semibold">{card.price}</div>
    )}

    {card.location !== undefined && (
      <div className="text-muted-foreground flex items-center gap-1 text-xs">
        <MapPin className="size-3 shrink-0" />
        {card.location}
      </div>
    )}

    {card.attributes !== undefined && card.attributes.length > 0 && (
      <div className="text-muted-foreground text-xs">
        {card.attributes.map((attribute) => `${attribute.label}: ${attribute.value}`).join(" · ")}
      </div>
    )}

    {/* `render` y no `asChild`: esta versión de shadcn va sobre Base UI. */}
    {card.url !== undefined && (
      <Button
        render={
          <a href={card.url} target="_blank" rel="noreferrer">
            Ver ficha
            <ExternalLink className="size-3" />
          </a>
        }
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
      />
    )}
  </div>
);

const Block = ({ block }: { block: ReplyBlockContract }): ReactNode => {
  switch (block.kind) {
    case "text":
      return <span className="text-sm whitespace-pre-wrap">{block.text}</span>;

    case "property_card":
      return <Card card={block.card} />;

    case "property_list":
      return (
        <div className="space-y-1">
          {block.intro !== undefined && <div className="text-sm">{block.intro}</div>}
          {block.items.map((card) => (
            <Card key={card.reference} card={card} />
          ))}
        </div>
      );

    case "quick_replies":
      return (
        <div className="mt-1.5 space-y-1.5">
          <div className="text-sm">{block.prompt}</div>
          {/*
           * Se ven como botones pero NO lo son: en el panel es una copia de lo
           * que el cliente tenía delante. Si fueran pulsables, un asesor
           * respondería sin querer en nombre del cliente.
           */}
          <div className="flex flex-wrap gap-1.5">
            {block.options.map((option) => (
              <Badge key={option.value} variant="secondary" className="font-normal">
                {option.label}
              </Badge>
            ))}
          </div>
        </div>
      );

    case "media":
      return (
        <a
          className="text-primary inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline"
          href={block.url}
          target="_blank"
          rel="noreferrer"
        >
          <ImageIcon className="size-3.5" />
          {block.caption ?? `[${block.mediaType}]`}
        </a>
      );

    case "link":
      return (
        <a
          className="text-primary inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline"
          href={block.url}
          target="_blank"
          rel="noreferrer"
        >
          {block.label}
          <ExternalLink className="size-3" />
        </a>
      );

    case "handoff_notice":
      /*
       * En cursiva y con icono: habla la PLATAFORMA, no el agente. Confundirlos
       * haría creer al asesor que el bot prometió algo que no dijo.
       */
      return (
        <em className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <UserRoundCheck className="size-3.5 shrink-0" />
          {block.message}
        </em>
      );

    case "location":
      return (
        <em className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <MapPin className="size-3.5 shrink-0" />
          Ubicación compartida ({block.latitude.toFixed(4)}, {block.longitude.toFixed(4)})
        </em>
      );

    case "unsupported":
      /*
       * Se muestra, no se oculta: el cliente mandó algo que el canal no pudo
       * entregar, y esconderlo dejaría un hueco inexplicable en el hilo.
       */
      return <em className="text-muted-foreground text-sm">[{block.description}]</em>;
  }
};

export const MessageBlocks = ({
  blocks,
}: {
  blocks: readonly ReplyBlockContract[];
}): ReactNode => (
  <>
    {blocks.map((block, index) => (
      <Block key={`${block.kind}-${String(index)}`} block={block} />
    ))}
  </>
);
