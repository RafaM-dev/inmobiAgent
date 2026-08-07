import type {
  KnowledgeCollectionContract,
  KnowledgeDocumentContract,
} from "@agentinmobi/contracts";
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";

const STATUS_LABEL: Record<KnowledgeDocumentContract["status"], string> = {
  PENDING: "En cola",
  INDEXING: "Indexando",
  INDEXED: "Listo",
  FAILED: "Falló",
};

/** Tipos que el extractor de texto plano sabe leer. Nada más se ofrece. */
const ACCEPTED = ".txt,.md,.markdown,.csv";

const mimeFor = (fileName: string): string =>
  /\.(md|markdown)$/i.test(fileName) ? "text/markdown" : "text/plain";

/**
 * Base de conocimiento.
 *
 * Es la pantalla donde la inmobiliaria le enseña al agente lo que sabe: sus
 * políticas, sus requisitos, sus preguntas frecuentes. Lo que entra aquí es lo
 * ÚNICO que el agente podrá citar; lo que no está, el agente dirá que no lo
 * sabe en vez de inventarlo.
 *
 * El estado de indexado se muestra siempre, incluido el motivo del fallo. Un
 * documento subido pero no indexado es invisible para el agente, y quien lo
 * subió tiene que verlo: si el producto dijera solo "subido", el cliente
 * culparía a la IA de no saber algo que cree haberle enseñado.
 *
 * Solo se aceptan archivos de texto. El único extractor que existe es de texto
 * plano; ofrecer un selector que acepte PDF y después fallar por dentro sería
 * prometer algo que el sistema no cumple.
 */
export const KnowledgePage = (): ReactNode => {
  const [collections, setCollections] = useState<KnowledgeCollectionContract[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocumentContract[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  /**
   * Borrar se confirma en dos pasos, en la propia fila. No se usa `confirm()`
   * del navegador: bloquea el hilo y, en un panel que además recibe eventos en
   * vivo, deja la pantalla congelada hasta que alguien la atienda.
   */
  const [confirming, setConfirming] = useState<string | null>(null);

  const fail = (cause: unknown, fallback: string): void => {
    setError(cause instanceof ApiError ? cause.message : fallback);
  };

  const loadCollections = useCallback(() => {
    api
      .collections()
      .then((response) => {
        setCollections(response.items);
        setSelected((current) => current ?? response.items[0]?.id ?? null);
      })
      .catch((cause: unknown) => {
        fail(cause, "No se pudieron cargar las colecciones");
      });
  }, []);

  const loadDocuments = useCallback((collectionId: string) => {
    api
      .documents(collectionId)
      .then((response) => {
        setDocuments(response.items);
      })
      .catch((cause: unknown) => {
        fail(cause, "No se pudieron cargar los documentos");
      });
  }, []);

  useEffect(loadCollections, [loadCollections]);

  useEffect(() => {
    if (selected !== null) loadDocuments(selected);
  }, [selected, loadDocuments]);

  const refresh = (): void => {
    loadCollections();
    if (selected !== null) loadDocuments(selected);
  };

  const ingest = (input: { title: string; content: string; mimeType: string; upload: boolean }) => {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    api
      .ingestDocument({
        collectionId: selected,
        title: input.title,
        sourceType: input.upload ? "UPLOAD" : "TEXT",
        mimeType: input.mimeType,
        content: input.content,
      })
      .then((response) => {
        setNotice(
          response.created
            ? `«${response.title}» está en cola de indexado.`
            : `«${response.title}» ya estaba en esta colección: mismo contenido, mismo documento.`,
        );
        setTitle("");
        setText("");
        refresh();
      })
      .catch((cause: unknown) => {
        fail(cause, "No se pudo subir el documento");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const submitText = (event: SyntheticEvent): void => {
    event.preventDefault();
    ingest({
      title: title.trim().length > 0 ? title.trim() : "Documento sin título",
      content: text,
      mimeType: "text/plain",
      upload: false,
    });
  };

  const submitFile = (file: File): void => {
    // El archivo se convierte a texto AQUÍ, no en el servidor: así lo que se
    // envía es exactamente lo que se va a indexar, sin sorpresas por el medio.
    file
      .text()
      .then((content) => {
        ingest({ title: file.name, content, mimeType: mimeFor(file.name), upload: true });
      })
      .catch(() => {
        setError("No se pudo leer el archivo");
      });
  };

  const act = (action: Promise<void>, done: string): void => {
    setBusy(true);
    setError(null);
    action
      .then(() => {
        setNotice(done);
        refresh();
      })
      .catch((cause: unknown) => {
        fail(cause, "La operación no se pudo completar");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const collection = collections.find((item) => item.id === selected) ?? null;

  return (
    <div className="page">
      <div className="page__header">
        <h1>Lo que sabe el agente</h1>
        <button type="button" className="button button--ghost" onClick={refresh}>
          Actualizar
        </button>
      </div>

      <div className="filters">
        {collections.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`chip${selected === item.id ? " is-active" : ""}`}
            onClick={() => {
              setSelected(item.id);
            }}
          >
            {item.name} ({item.documentCount})
          </button>
        ))}
        {collections.length === 0 && (
          <span className="empty">Todavía no hay ninguna colección.</span>
        )}
      </div>

      {error !== null && <p className="error">{error}</p>}
      {notice !== null && <p className="notice">{notice}</p>}

      {collection !== null && (
        <>
          <div className="knowledge__upload">
            <form onSubmit={submitText}>
              <label className="field">
                <span>Título</span>
                <input
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                  }}
                  placeholder="Requisitos para arrendar"
                />
              </label>

              <label className="field">
                <span>Texto</span>
                <textarea
                  rows={6}
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                  }}
                  placeholder={"## Requisitos\nCédula, certificado laboral…"}
                />
              </label>

              <div className="knowledge__actions">
                <button
                  type="submit"
                  className="button button--primary"
                  disabled={busy || text.trim().length === 0}
                >
                  Añadir texto
                </button>

                <label className="button button--ghost">
                  Subir archivo
                  <input
                    type="file"
                    accept={ACCEPTED}
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) submitFile(file);
                      event.target.value = "";
                    }}
                  />
                </label>

                <span className="hint">Solo texto: .txt, .md, .csv</span>
              </div>
            </form>
          </div>

          {documents.length === 0 ? (
            <p className="empty">
              Esta colección está vacía. Sin documentos, el agente dirá que no tiene esa
              información — que es lo correcto, pero no ayuda a nadie.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Estado</th>
                  <th>Fragmentos</th>
                  <th>Modelo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.id}>
                    <td>
                      {document.title}
                      {document.failureReason !== undefined && (
                        <div className="row__note">{document.failureReason}</div>
                      )}
                    </td>
                    <td>
                      <span className={`badge badge--${document.status.toLowerCase()}`}>
                        {STATUS_LABEL[document.status]}
                      </span>
                    </td>
                    <td>{document.chunkCount}</td>
                    <td className="cell--muted">{document.embeddingModel ?? "—"}</td>
                    <td className="cell--actions">
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={busy}
                        onClick={() => {
                          act(api.reindexDocument(document.id), "Documento reencolado.");
                        }}
                      >
                        Reindexar
                      </button>
                      {confirming === document.id ? (
                        <>
                          <button
                            type="button"
                            className="button button--danger"
                            disabled={busy}
                            onClick={() => {
                              setConfirming(null);
                              act(
                                api.deleteDocument(document.id),
                                "Documento borrado. El agente ya no puede citarlo.",
                              );
                            }}
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => {
                              setConfirming(null);
                            }}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="button button--ghost"
                          disabled={busy}
                          onClick={() => {
                            setConfirming(document.id);
                          }}
                        >
                          Borrar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
};
