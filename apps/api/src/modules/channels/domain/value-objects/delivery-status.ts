/**
 * Estado de entrega de un mensaje saliente.
 *
 * Vive en el dominio y no en el puerto del canal porque no es un detalle de
 * ningún proveedor: "enviado", "entregado" y "leído" son el vocabulario con el
 * que el producto habla de lo que le pasó a un mensaje, y lo usan tanto el
 * repositorio como el back-office.
 *
 * El orden de la escala importa: los acuses llegan desordenados —un "entregado"
 * puede aparecer después de un "leído"— y un estado nunca debe retroceder.
 */
export const DeliveryStatus = {
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  READ: "READ",
  FAILED: "FAILED",
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

/** Cuanto mayor, más avanzado. `FAILED` es terminal y gana a todos. */
export const DELIVERY_RANK: Record<DeliveryStatus, number> = {
  SENT: 0,
  DELIVERED: 1,
  READ: 2,
  FAILED: 3,
};

export interface DeliveryStatusUpdate {
  /** Id del mensaje EN EL PROVEEDOR: es lo que devolvió el envío. */
  readonly providerMessageId: string;
  readonly status: DeliveryStatus;
  readonly occurredAt: Date;
  readonly reason?: string;
}
