import {
  createCollectionRequestSchema,
  ingestDocumentRequestSchema,
  type IngestDocumentResponse,
  type KnowledgeCollectionListResponse,
  type KnowledgeDocumentListResponse,
} from "@agentinmobi/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ValidationError } from "../../../../platform/errors/app-error";
import { isErr } from "../../../../platform/result/result";
import type { CreateCollectionUseCase } from "../../application/use-cases/create-collection.use-case";
import type { IngestDocumentUseCase } from "../../application/use-cases/ingest-document.use-case";
import type {
  ListCollectionsUseCase,
  ListDocumentsUseCase,
} from "../../application/use-cases/list-knowledge.use-cases";
import type {
  DeleteDocumentUseCase,
  ReindexDocumentUseCase,
} from "../../application/use-cases/manage-document.use-cases";

type Guard = (
  request: FastifyRequest,
  reply: FastifyReply,
  done: (error?: Error) => void,
) => void;

export interface KnowledgeRoutesDeps {
  listCollections: ListCollectionsUseCase;
  listDocuments: ListDocumentsUseCase;
  createCollection: CreateCollectionUseCase;
  ingestDocument: IngestDocumentUseCase;
  reindexDocument: ReindexDocumentUseCase;
  deleteDocument: DeleteDocumentUseCase;
  requireSession: Guard;
  /** Escribir en la base de conocimiento cambia lo que el agente dirá a TODOS. */
  requireEditor: Guard;
}

interface CollectionParams {
  collectionId: string;
}

interface DocumentParams {
  documentId: string;
}

/**
 * Base de conocimiento del back-office.
 *
 * Leer y escribir tienen guardias distintos por una razón concreta: subir un
 * documento no es un cambio de pantalla, es un cambio en lo que el agente
 * responderá a cientos de clientes. Un rol de solo lectura puede auditar qué
 * sabe el agente sin poder cambiarlo.
 *
 * La subida NO usa `multipart`. El único extractor que existe es de texto plano
 * (D26); aceptar un binario que después no se puede leer sería prometer algo
 * que el sistema no cumple. El navegador convierte el archivo a texto y lo que
 * llega aquí es exactamente lo que se va a indexar.
 */
export const registerKnowledgeRoutes = (
  app: FastifyInstance,
  deps: KnowledgeRoutesDeps,
): void => {
  const read = { preHandler: deps.requireSession };
  const write = { preHandler: [deps.requireSession, deps.requireEditor] };

  app.get("/api/knowledge/collections", read, async (_request, reply) => {
    const result = await deps.listCollections.execute();
    if (isErr(result)) throw result.error;

    const body: KnowledgeCollectionListResponse = {
      items: result.value.map((collection) => ({
        id: collection.id,
        slug: collection.slug,
        name: collection.name,
        ...(collection.description !== undefined ? { description: collection.description } : {}),
        documentCount: collection.documentCount,
      })),
    };
    return reply.send(body);
  });

  app.post("/api/knowledge/collections", write, async (request, reply) => {
    const parsed = createCollectionRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Colección inválida");

    const result = await deps.createCollection.execute({
      name: parsed.data.name,
      slug: parsed.data.slug,
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
    });
    if (isErr(result)) throw result.error;

    // 200 y no 201 cuando ya existía: crear una colección es idempotente por
    // slug, y decir "creado" de algo que no se creó sería mentir.
    return reply.status(result.value.created ? 201 : 200).send({ id: result.value.id });
  });

  app.get<{ Params: CollectionParams }>(
    "/api/knowledge/collections/:collectionId/documents",
    read,
    async (request, reply) => {
      const result = await deps.listDocuments.execute({
        collectionId: request.params.collectionId,
      });
      if (isErr(result)) throw result.error;

      const body: KnowledgeDocumentListResponse = {
        items: result.value.map((document) => ({
          id: document.id,
          collectionId: document.collectionId,
          title: document.title,
          sourceType: document.sourceType,
          mimeType: document.mimeType,
          status: document.status,
          chunkCount: document.chunkCount,
          ...(document.embeddingModel !== undefined
            ? { embeddingModel: document.embeddingModel }
            : {}),
          ...(document.failureReason !== undefined
            ? { failureReason: document.failureReason }
            : {}),
          ...(document.indexedAt !== undefined
            ? { indexedAt: document.indexedAt.toISOString() }
            : {}),
          updatedAt: document.updatedAt.toISOString(),
        })),
      };
      return reply.send(body);
    },
  );

  app.post("/api/knowledge/documents", write, async (request, reply) => {
    const parsed = ingestDocumentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(
        "Documento inválido",
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }

    /*
     * El base64 se decodifica AQUÍ, en el borde, y no dentro del caso de uso.
     * Que un PDF llegue en base64 es una consecuencia de haber elegido JSON
     * para el transporte; el caso de uso solo tiene que saber de bytes.
     *
     * Node no falla ante un base64 inválido: descarta lo que no reconoce y
     * devuelve lo que pueda. Por eso se comprueba re-codificando, en vez de
     * dejar que un archivo cortado a la mitad se indexe como si estuviera bien.
     */
    let content: Buffer;
    if (parsed.data.encoding === "base64") {
      content = Buffer.from(parsed.data.content, "base64");
      if (content.toString("base64") !== parsed.data.content.replace(/\s/g, "")) {
        throw new ValidationError("El archivo llegó dañado. Vuelve a subirlo.");
      }
    } else {
      content = Buffer.from(parsed.data.content, "utf8");
    }

    const result = await deps.ingestDocument.execute({
      collectionId: parsed.data.collectionId,
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      sourceType: parsed.data.sourceType,
      mimeType: parsed.data.mimeType,
      content,
    });
    if (isErr(result)) throw result.error;

    const body: IngestDocumentResponse = {
      documentId: result.value.documentId,
      title: result.value.title,
      status: result.value.status,
      created: result.value.created,
    };

    // 202 y no 201: el documento está guardado, pero todavía NO indexado. El
    // agente aún no puede citarlo, y el estado de la respuesta lo dice.
    return reply.status(202).send(body);
  });

  app.post<{ Params: DocumentParams }>(
    "/api/knowledge/documents/:documentId/reindex",
    write,
    async (request, reply) => {
      const result = await deps.reindexDocument.execute(request.params.documentId);
      if (isErr(result)) throw result.error;
      return reply.status(202).send();
    },
  );

  app.delete<{ Params: DocumentParams }>(
    "/api/knowledge/documents/:documentId",
    write,
    async (request, reply) => {
      const result = await deps.deleteDocument.execute(request.params.documentId);
      if (isErr(result)) throw result.error;
      return reply.status(204).send();
    },
  );
};
