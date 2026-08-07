import type { ChannelAccount } from "../../domain/entities/channel-account";
import type { ChannelAccountView } from "../ports/chat-channel";

/** Agregado → vista que reciben los adaptadores. Solo lectura, sin comportamiento. */
export const toAccountView = (account: ChannelAccount): ChannelAccountView => ({
  id: account.id,
  tenantId: account.tenantId,
  channelType: account.channelType,
  externalId: account.externalId,
  displayName: account.displayName,
  config: account.config,
});
