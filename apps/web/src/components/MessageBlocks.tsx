import type { PropertyCard, ReplyBlockContract } from "@agentinmobi/contracts";
import type { ReactNode } from "react";

/**
 * Pinta los bloques de un mensaje.
 *
 * El asesor tiene que ver EXACTAMENTE lo que vio el cliente: las mismas fichas
 * con los mismos precios, los mismos botones. Por eso el back-office recibe
 * bloques y no HTML ni texto plano — es el mismo contrato que sale por WhatsApp,
 * pintado con otro estilo.
 *
 * El `switch` es exhaustivo y el tipo lo obliga: si mañana aparece un tipo de
 * bloque nuevo, este archivo deja de compilar en vez de mostrar un hueco.
 */

const Card = ({ card }: { card: PropertyCard }): ReactNode => (
  <div className="card">
    <div className="card__title">{card.title}</div>
    {card.price !== undefined && <div className="card__price">{card.price}</div>}
    {card.location !== undefined && <div className="card__meta">{card.location}</div>}
    {card.attributes !== undefined && card.attributes.length > 0 && (
      <div className="card__meta">
        {card.attributes.map((attribute) => `${attribute.label}: ${attribute.value}`).join(" · ")}
      </div>
    )}
    {card.url !== undefined && (
      <a className="card__meta" href={card.url} target="_blank" rel="noreferrer">
        Ver ficha
      </a>
    )}
  </div>
);

const Block = ({ block }: { block: ReplyBlockContract }): ReactNode => {
  switch (block.kind) {
    case "text":
      return <span>{block.text}</span>;

    case "property_card":
      return <Card card={block.card} />;

    case "property_list":
      return (
        <div>
          {block.intro !== undefined && <div>{block.intro}</div>}
          {block.items.map((card) => (
            <Card key={card.reference} card={card} />
          ))}
        </div>
      );

    case "quick_replies":
      return (
        <div>
          <div>{block.prompt}</div>
          <div className="options">
            {block.options.map((option) => (
              <span key={option.value} className="option">
                {option.label}
              </span>
            ))}
          </div>
        </div>
      );

    case "media":
      return (
        <a href={block.url} target="_blank" rel="noreferrer">
          {block.caption ?? `[${block.mediaType}]`}
        </a>
      );

    case "link":
      return (
        <a href={block.url} target="_blank" rel="noreferrer">
          {block.label}
        </a>
      );

    case "handoff_notice":
      return <em>{block.message}</em>;

    case "location":
      return (
        <em>
          Ubicación compartida ({block.latitude.toFixed(4)}, {block.longitude.toFixed(4)})
        </em>
      );

    case "unsupported":
      return <em>[{block.description}]</em>;
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
