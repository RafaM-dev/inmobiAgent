import { agentModule } from "../modules/agent";
import { appointmentsModule } from "../modules/appointments";
import { catalogModule } from "../modules/catalog";
import { channelsModule } from "../modules/channels";
import { conversationModule } from "../modules/conversation";
import { identityModule } from "../modules/identity";
import { knowledgeModule } from "../modules/knowledge";
import { leadsModule } from "../modules/leads";
import type { AppModule } from "./container";

/**
 * Registro de módulos del monolito modular.
 *
 * El ORDEN importa solo para el arranque y el apagado ordenado: los módulos se
 * inician en este orden y se detienen en el inverso. Las dependencias entre
 * ellos se resuelven por DI y por eventos, no por posición en esta lista.
 *
 * Hoja de ruta (docs/00-ARCHITECTURE.md §13):
 *   F1 → identity, channels(console), conversation   ✅
 *   F2 → agent + MockLLMProvider                     ✅
 *   F3 → catalog                                      ✅
 *   F4 → leads, appointments                          ✅
 *   F5 → knowledge                                    ✅
 *   F6 → channels(whatsapp)  — solo un adaptador más en `channels`
 *   F7 → analytics, handoff
 */
export const appModules: readonly AppModule[] = [
  identityModule,
  channelsModule,
  conversationModule,
  catalogModule,
  leadsModule,
  appointmentsModule,
  knowledgeModule,
  agentModule,
] as AppModule[];
