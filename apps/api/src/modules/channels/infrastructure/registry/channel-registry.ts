import { NotFoundError } from "../../../../platform/errors/app-error";
import type { ChannelType } from "../../domain/value-objects/channel-type";
import type { ChatChannel, ChannelRegistry } from "../../application/ports/chat-channel";

/**
 * Catálogo de canales instalados.
 *
 * Se construye una sola vez en el registro del módulo con los adaptadores
 * disponibles. Añadir WhatsApp en F6 es añadir un elemento a ese array: ni el
 * registro ni ningún consumidor cambian.
 */
export class InMemoryChannelRegistry implements ChannelRegistry {
  private readonly byType = new Map<ChannelType, ChatChannel>();

  constructor(channels: readonly ChatChannel[]) {
    for (const channel of channels) {
      if (this.byType.has(channel.type)) {
        throw new Error(`Canal duplicado en el registro: ${channel.type}`);
      }
      this.byType.set(channel.type, channel);
    }
  }

  get(type: ChannelType): ChatChannel | undefined {
    return this.byType.get(type);
  }

  require(type: ChannelType): ChatChannel {
    const channel = this.byType.get(type);
    if (!channel) throw new NotFoundError("Canal", type);
    return channel;
  }

  available(): readonly ChannelType[] {
    return [...this.byType.keys()];
  }
}
