import { z } from "zod";
import { idSchema, isoDateTimeSchema, slugSchema } from "../common/primitives";

/**
 * Base de conocimiento: lo que la inmobiliaria sabe y el agente puede CITAR.
 *
 * El estado de indexado se publica entero —incluido el motivo del fallo— porque
 * un documento subido pero no indexado es invisible para el agente, y quien lo
 * subió tiene que poder ver que su documento todavía no cuenta. Un producto que
 * dice "subido" y calla que nunca llegó al índice hace que el cliente culpe a la
 * IA de no saber algo que él cree haberle enseñado.
 */

export const documentStatusSchema = z.enum(["PENDING", "INDEXING", "INDEXED", "FAILED"]);
export type DocumentStatusContract = z.infer<typeof documentStatusSchema>;

export const documentSourceTypeSchema = z.enum(["UPLOAD", "URL", "TEXT"]);
export type DocumentSourceTypeContract = z.infer<typeof documentSourceTypeSchema>;

export const knowledgeCollectionSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  name: z.string(),
  description: z.string().optional(),
  documentCount: z.number().int(),
});
export type KnowledgeCollectionContract = z.infer<typeof knowledgeCollectionSchema>;

export const knowledgeCollectionListResponseSchema = z.object({
  items: z.array(knowledgeCollectionSchema),
});
export type KnowledgeCollectionListResponse = z.infer<
  typeof knowledgeCollectionListResponseSchema
>;

export const knowledgeDocumentSchema = z.object({
  id: idSchema,
  collectionId: idSchema,
  title: z.string(),
  sourceType: documentSourceTypeSchema,
  mimeType: z.string(),
  status: documentStatusSchema,
  /** Fragmentos indexados. Cero con estado `INDEXED` significa documento vacío. */
  chunkCount: z.number().int(),
  /** Modelo con el que se vectorizó. Cambiarlo obliga a reindexar. */
  embeddingModel: z.string().optional(),
  failureReason: z.string().optional(),
  indexedAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema,
});
export type KnowledgeDocumentContract = z.infer<typeof knowledgeDocumentSchema>;

export const knowledgeDocumentListResponseSchema = z.object({
  items: z.array(knowledgeDocumentSchema),
});
export type KnowledgeDocumentListResponse = z.infer<typeof knowledgeDocumentListResponseSchema>;

/**
 * Alta de documento.
 *
 * El contenido viaja como texto, no como `multipart`: el único extractor que
 * existe hoy es de texto plano (D26), y aceptar un PDF que después no se puede
 * leer sería prometer algo que el sistema no cumple. El navegador convierte el
 * archivo a texto antes de enviarlo, y lo que llega aquí es exactamente lo que
 * se va a indexar.
 */
export const ingestDocumentRequestSchema = z.object({
  collectionId: idSchema,
  title: z.string().min(1).max(200).optional(),
  sourceType: z.enum(["UPLOAD", "TEXT"]),
  mimeType: z.string().min(3).max(120),
  content: z.string().min(1),
});
export type IngestDocumentRequest = z.infer<typeof ingestDocumentRequestSchema>;

export const ingestDocumentResponseSchema = z.object({
  documentId: idSchema,
  title: z.string(),
  status: documentStatusSchema,
  /** `false` si ese mismo contenido ya estaba en la colección. */
  created: z.boolean(),
});
export type IngestDocumentResponse = z.infer<typeof ingestDocumentResponseSchema>;

export const createCollectionRequestSchema = z.object({
  slug: slugSchema,
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
});
export type CreateCollectionRequest = z.infer<typeof createCollectionRequestSchema>;
