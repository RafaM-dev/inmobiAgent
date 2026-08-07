import { Prisma } from "../../generated/prisma/client";
import type { IdempotencyStore } from "../events/event-bus";
import { TenantContext } from "../tenancy/tenant-context";
import type { Database } from "./prisma";

/**
 * Idempotencia de consumidores respaldada por la tabla `inbox_events`.
 *
 * `claim` se apoya en la clave primaria compuesta (eventId, handlerName): la
 * propia base garantiza la exclusión mutua, sin locks aplicativos ni carreras
 * entre réplicas del worker.
 */
export class PrismaIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Database) {}

  async claim(eventId: string, handlerName: string): Promise<boolean> {
    try {
      await this.db.raw().inboxEvent.create({
        data: {
          eventId,
          handlerName,
          tenantId: TenantContext.peek()?.tenantId ?? "system",
        },
      });
      return true;
    } catch (error) {
      // P2002 = violación de unicidad ⇒ otro proceso ya lo tomó.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  }

  async release(eventId: string, handlerName: string): Promise<void> {
    await this.db
      .raw()
      .inboxEvent.deleteMany({ where: { eventId, handlerName } });
  }
}
