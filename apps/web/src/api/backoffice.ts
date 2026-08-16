import {
  appointmentActionResponseSchema,
  appointmentListResponseSchema,
  channelAccountListResponseSchema,
  connectChannelResponseSchema,
  conversationDetailSchema,
  inviteUserResponseSchema,
  inboxListResponseSchema,
  ingestDocumentResponseSchema,
  knowledgeCollectionListResponseSchema,
  knowledgeDocumentListResponseSchema,
  leadListResponseSchema,
  leadSummarySchema,
  redeemTokenResponseSchema,
  sessionResponseSchema,
  settingsResponseSchema,
  teamListResponseSchema,
  teamMemberSchema,
  usageSummarySchema,
  type AppointmentActionResponse,
  type AppointmentListResponse,
  type AssignLeadRequest,
  type CancelAppointmentRequest,
  type ChangeLeadStatusRequest,
  type ChannelAccountListResponse,
  type ConnectChannelResponse,
  type ConnectWhatsAppRequest,
  type ConversationDetail,
  type InviteUserRequest,
  type InviteUserResponse,
  type RedeemTokenRequest,
  type RedeemTokenResponse,
  type TeamListResponse,
  type TeamMember,
  type UpdateTeamMemberRequest,
  type CreateCollectionRequest,
  type InboxListResponse,
  type IngestDocumentRequest,
  type IngestDocumentResponse,
  type KnowledgeCollectionListResponse,
  type KnowledgeDocumentListResponse,
  type LeadListResponse,
  type LeadSummaryContract,
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

  changeLeadStatus: (
    leadId: string,
    body: ChangeLeadStatusRequest,
  ): Promise<LeadSummaryContract> =>
    request(`/api/leads/${leadId}/status`, leadSummarySchema, { method: "PATCH", body }),

  assignLead: (leadId: string, body: AssignLeadRequest): Promise<LeadSummaryContract> =>
    request(`/api/leads/${leadId}/assignment`, leadSummarySchema, { method: "PATCH", body }),

  appointments: (filters: { days?: number; mine?: boolean } = {}): Promise<AppointmentListResponse> =>
    request(`/api/appointments${query(filters)}`, appointmentListResponseSchema),

  confirmAppointment: (appointmentId: string): Promise<AppointmentActionResponse> =>
    request(`/api/appointments/${appointmentId}/confirm`, appointmentActionResponseSchema, {
      method: "POST",
      body: {},
    }),

  cancelAppointment: (
    appointmentId: string,
    body: CancelAppointmentRequest = {},
  ): Promise<AppointmentActionResponse> =>
    request(`/api/appointments/${appointmentId}/cancel`, appointmentActionResponseSchema, {
      method: "POST",
      body,
    }),

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

  /* --------------------------------------------------------------- equipo */

  team: (): Promise<TeamListResponse> => request("/api/users", teamListResponseSchema),

  inviteUser: (body: InviteUserRequest): Promise<InviteUserResponse> =>
    request("/api/users", inviteUserResponseSchema, { method: "POST", body }),

  updateTeamMember: (userId: string, body: UpdateTeamMemberRequest): Promise<TeamMember> =>
    request(`/api/users/${userId}`, teamMemberSchema, { method: "PATCH", body }),

  /* -------------------------------------------------- entrar sin poder entrar */

  forgotPassword: (body: { tenantSlug: string; email: string }): Promise<void> =>
    requestVoid("/api/auth/forgot-password", { method: "POST", body }),

  redeemToken: (body: RedeemTokenRequest): Promise<RedeemTokenResponse> =>
    request("/api/auth/redeem", redeemTokenResponseSchema, { method: "POST", body }),
};
