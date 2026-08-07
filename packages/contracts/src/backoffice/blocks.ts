import { z } from "zod";

/**
 * Bloques de respuesta, tal como viajan a la aplicación web.
 *
 * Es el MISMO contrato que produce el agente (`ReplyBlock` en el dominio de
 * `channels`), publicado aquí como schema Zod porque esto es la frontera de la
 * API. La duplicación es deliberada y está vigilada: el mapeador del back-office
 * comprueba en tiempo de compilación que el tipo del dominio satisface este
 * schema, así que si alguien añade un tipo de bloque y se olvida de publicarlo,
 * no compila.
 *
 * Que el navegador reciba BLOQUES y no HTML es lo que permite que la misma
 * conversación se vea en el inbox del asesor y en WhatsApp sin escribir dos
 * veces la lógica de presentación.
 */

export const propertyCardSchema = z.object({
  reference: z.string(),
  title: z.string(),
  price: z.string().optional(),
  location: z.string().optional(),
  summary: z.string().optional(),
  attributes: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  imageUrl: z.string().optional(),
  url: z.string().optional(),
});
export type PropertyCard = z.infer<typeof propertyCardSchema>;

export const replyBlockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("property_card"), card: propertyCardSchema }),
  z.object({
    kind: z.literal("property_list"),
    intro: z.string().optional(),
    items: z.array(propertyCardSchema),
    more: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("quick_replies"),
    prompt: z.string(),
    options: z.array(z.object({ label: z.string(), value: z.string() })),
  }),
  z.object({
    kind: z.literal("media"),
    url: z.string(),
    mediaType: z.enum(["image", "video", "audio", "document"]),
    caption: z.string().optional(),
  }),
  z.object({ kind: z.literal("link"), url: z.string(), label: z.string() }),
  z.object({ kind: z.literal("handoff_notice"), reason: z.string(), message: z.string() }),
  /* Lo que puede llegar del cliente y no sale de nosotros. */
  z.object({ kind: z.literal("location"), latitude: z.number(), longitude: z.number() }),
  z.object({ kind: z.literal("unsupported"), description: z.string() }),
]);
export type ReplyBlockContract = z.infer<typeof replyBlockSchema>;
