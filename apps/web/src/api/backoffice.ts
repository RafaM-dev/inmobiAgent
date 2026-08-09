import {
  appointmentListResponseSchema,
  channelAccountListResponseSchema,
  connectChannelResponseSchema,
  conversationDetailSchema,
  inboxListResponseSchema,
  ingestDocumentResponseSchema,
  knowledgeCollectionListResponseSchema,
  knowledgeDocumentListResponseSchema,
  leadListResponseSchema,
  sessionResponseSchema,
  settingsResponseSchema,
  usageSummarySchema,
  type AppointmentListResponse,
  type ChannelAccountListResponse,
  type ConnectChannelResponse,
  type ConnectWhatsAppRequest,
  type ConversationDetail,
  type CreateCollectionRequest,
  type InboxListResponse,
  type IngestDocumentRequest,
  type IngestDocumentResponse,
  type KnowledgeCollectionListResponse,
  type KnowledgeDocumentListResponse,
  type LeadListResponse,
  type LoginRequest,
  type SessionResponse,
  type SettingsResponse,
  type UpdateAgentSettingsRequest,
  type UsageSummary,
} from "@agentinmobi/contracts";
import { request, requestVoid } from "./client";

/**
 * Todas las llamadas del back-office, en un sitio.
 *
 * Cada una devuelve el tipo del contrato compartido, ya validado. Los
 * componentes no ven `fetch`, ni rutas, ni JSON sin tipar: piden datos.
 */

const query = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered.length > 0 ? `?${rendered}` : "";
};

export const api = {
  login: (credentials: LoginRequest): Promise<SessionResponse> =>
    request("/api/auth/login", sessionResponseSchema, { method: "POST", body: credentials }),

  me: (signal?: AbortSignal): Promise<SessionResponse> =>
    request("/api/auth/me", sessionResponseSchema, ...(signal ? [{ signal }] : [])),

  logout: (): Promise<void> => requestVoid("/api/auth/logout", { method: "POST" }),

  inbox: (
    filters: { status?: string; mine?: boolean; limit?: number } = {},
  ): Promise<InboxListResponse> =>
    request(`/api/inbox${query(filters)}`, inboxListResponseSchema),

  conversation: (conversationId: string): Promise<ConversationDetail> =>
    request(`/api/inbox/${conversationId}`, conversationDetailSchema),

  takeover: (conversationId: string): Promise<void> =>
    requestVoid(`/api/inbox/${conversationId}/takeover`, { method: "POST", body: {} }),

  release: (conversationId: string): Promise<void> =>
    requestVoid(`/api/inbox/${conversationId}/release`, { method: "POST" }),

  sendMessage: (conversationId: string, text: string): Promise<void> =>
    requestVoid(`/api/inbox/${conversationId}/messages`, { method: "POST", body: { text } }),

  leads: (filters: { band?: string; status?: string; mine?: boolean } = {}): Promise<LeadListResponse> =>
    request(`/api/leads${query(filters)}`, leadListResponseSchema),

  appointments: (filters: { days?: number; mine?: boolean } = {}): Promise<AppointmentListResponse> =>
    request(`/api/appointments${query(filters)}`, appointmentListResponseSchema),

  /* ---------------------------------------------------------------- saber */

  collections: (): Promise<KnowledgeCollectionListResponse> =>
    request("/api/knowledge/collections", knowledgeCollectionListResponseSchema),

  createCollection: (body: CreateCollectionRequest): Promise<void> =>
    requestVoid("/api/knowledge/collections", { method: "POST", body }),

  documents: (collectionId: string): Promise<KnowledgeDocumentListResponse> =>
    request(
      `/api/knowledge/collections/${collectionId}/documents`,
      knowledgeDocumentListResponseSchema,
    ),

  ingestDocument: (body: IngestDocumentRequest): Promise<IngestDocumentResponse> =>
    request("/api/knowledge/documents", ingestDocumentResponseSchema, { method: "POST", body }),

  reindexDocument: (documentId: string): Promise<void> =>
    requestVoid(`/api/knowledge/documents/${documentId}/reindex`, { method: "POST" }),

  deleteDocument: (documentId: string): Promise<void> =>
    requestVoid(`/api/knowledge/documents/${documentId}`, { method: "DELETE" }),

  /* -------------------------------------------------------- configuración */

  settings: (): Promise<SettingsResponse> => request("/api/settings", settingsResponseSchema),

  updateSettings: (body: UpdateAgentSettingsRequest): Promise<SettingsResponse> =>
    request("/api/settings", settingsResponseSchema, { method: "PATCH", body }),

  channelAccounts: (): Promise<ChannelAccountListResponse> =>
    request("/api/channels/accounts", channelAccountListResponseSchema),

  connectWhatsApp: (body: ConnectWhatsAppRequest): Promise<ConnectChannelResponse> =>
    request("/api/channels/whatsapp", connectChannelResponseSchema, { method: "POST", body }),

  usage: (): Promise<UsageSummary> => request("/api/usage", usageSummarySchema),
};
