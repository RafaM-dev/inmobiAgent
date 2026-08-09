import type {
  KnowledgeCollectionContract,
  KnowledgeDocumentContract,
} from "@agentinmobi/contracts";
import { BookOpen, FileUp, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorNotice, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../api/backoffice";
import { ApiError } from "../api/client";

const STATUS_LABEL: Record<KnowledgeDocumentContract["status"], string> = {
  PENDING: "En cola",
  INDEXING: "Indexando",
  INDEXED: "Listo",
  FAILED: "Falló",
};

const STATUS_VARIANT: Record<
  KnowledgeDocumentContract["status"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  PENDING: "outline",
  INDEXING: "secondary",
  INDEXED: "default",
  FAILED: "destructive",
};

/** Tipos que el extractor de texto plano sabe leer. Nada más se ofrece. */
const ACCEPTED = ".txt,.md,.markdown,.csv,.pdf,.docx";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Tipo por extensión, y NO `file.type`.
 *
 * El navegador rellena `file.type` a partir del registro del sistema, y en
 * Windows llega vacío más veces de las que parece. La extensión la controla
 * quien sube el archivo y no depende de cómo esté configurada su máquina.
 */
const mimeFor = (fileName: string): string => {
  if (/\.pdf$/i.test(fileName)) return "application/pdf";
  if (/\.docx$/i.test(fileName)) return DOCX;
  if (/\.(md|markdown)$/i.test(fileName)) return "text/markdown";
  if (/\.csv$/i.test(fileName)) return "text/csv";
  return "text/plain";
};

/** Los formatos binarios no sobreviven a `file.text()`: viajan en base64. */
const isBinary = (mimeType: string): boolean =>
  mimeType === "application/pdf" || mimeType === DOCX;

const toBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // A trozos: `String.fromCharCode(...bytes)` con un archivo de varios megas
  // revienta la pila de llamadas del navegador.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
};

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
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  /**
   * Borrar se confirma en un diálogo, no con el `confirm()` del navegador: ése
   * bloquea el hilo y, en un panel que además recibe eventos en vivo, deja la
   * pantalla congelada hasta que alguien la atienda.
   */
  const [confirming, setConfirming] = useState<KnowledgeDocumentContract | null>(null);

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

  const ingest = (input: {
    title: string;
    content: string;
    mimeType: string;
    upload: boolean;
    encoding: "utf8" | "base64";
  }) => {
    if (selected === null) return;
    setBusy(true);
    setError(null);

    api
      .ingestDocument({
        collectionId: selected,
        title: input.title,
        sourceType: input.upload ? "UPLOAD" : "TEXT",
        mimeType: input.mimeType,
        content: input.content,
        encoding: input.encoding,
      })
      .then((response) => {
        if (response.created) {
          toast.success(`«${response.title}» está en cola de indexado.`);
        } else {
          // La ingesta es idempotente por huella: subir dos veces el mismo
          // reglamento no crea dos reglamentos, y conviene decirlo.
          toast.info(`«${response.title}» ya estaba: mismo contenido, mismo documento.`);
        }
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
      encoding: "utf8",
    });
  };

  const submitFile = (file: File): void => {
    /*
     * Un PDF o un `.docx` se mandan TAL CUAL, en base64: el texto lo saca el
     * servidor. Antes el navegador convertía el archivo a texto y por eso solo
     * cabían formatos de texto; hacer aquí lo que hace falta para leer un PDF
     * significaría llevar un lector de PDF a cada navegador y volver a
     * comprobarlo cada vez que alguien cambie de móvil.
     */
    const mimeType = mimeFor(file.name);
    const read = isBinary(mimeType) ? toBase64(file) : file.text();

    read
      .then((content) => {
        ingest({
          title: file.name,
          content,
          mimeType,
          upload: true,
          encoding: isBinary(mimeType) ? "base64" : "utf8",
        });
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
        toast.success(done);
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
    <Page>
      <PageHeader
        title="Lo que sabe el agente"
        description="Lo que entra aquí es lo único que el agente puede citar. Lo que no esté, dirá que no lo sabe — en vez de inventarlo."
      >
        <Button type="button" variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="size-4" />
          Actualizar
        </Button>
      </PageHeader>

      {collections.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Todavía no hay ninguna colección"
          hint="Una colección agrupa documentos de un mismo tipo: políticas, requisitos, preguntas frecuentes."
        />
      ) : (
        <Tabs
          value={selected ?? ""}
          onValueChange={(value) => {
            setSelected(String(value));
          }}
        >
          <TabsList>
            {collections.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.name}
                <Badge variant="secondary" className="ml-1.5 text-[10px]">
                  {item.documentCount}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <ErrorNotice message={error} />

      {collection !== null && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Añadir a «{collection.name}»</CardTitle>
              <CardDescription>PDF, Word (.docx) y texto: .txt, .md, .csv</CardDescription>
            </CardHeader>

            <CardContent>
              <form className="space-y-4" onSubmit={submitText}>
                <div className="space-y-2">
                  <Label htmlFor="doc-title">Título</Label>
                  <Input
                    id="doc-title"
                    value={title}
                    placeholder="Requisitos para arrendar"
                    onChange={(event) => {
                      setTitle(event.target.value);
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="doc-text">Texto</Label>
                  <Textarea
                    id="doc-text"
                    rows={6}
                    value={text}
                    placeholder={"## Requisitos\nCédula, certificado laboral…"}
                    className="font-mono text-xs"
                    onChange={(event) => {
                      setText(event.target.value);
                    }}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={busy || text.trim().length === 0}>
                    Añadir texto
                  </Button>

                  {/*
                   * Un `<label>` con el input oculto: es la única forma de que
                   * el selector de archivos se vea como el resto de botones sin
                   * perder accesibilidad por teclado.
                   */}
                  <Button
                    variant="outline"
                    render={
                      <label>
                        <FileUp className="size-4" />
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
                    }
                  />
                </div>
              </form>
            </CardContent>
          </Card>

          {documents.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="Esta colección está vacía"
              hint="Sin documentos, el agente dirá que no tiene esa información — que es lo correcto, pero no ayuda a nadie."
            />
          ) : (
            <Card className="overflow-hidden py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Documento</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Fragmentos</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell>
                        <div className="font-medium">{document.title}</div>
                        {document.failureReason !== undefined && (
                          <div className="text-destructive mt-0.5 text-xs">
                            {document.failureReason}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[document.status]}>
                          {STATUS_LABEL[document.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{document.chunkCount}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {document.embeddingModel ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              act(api.reindexDocument(document.id), "Documento reencolado.");
                            }}
                          >
                            <RefreshCw className="size-4" />
                            Reindexar
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={busy}
                            onClick={() => {
                              setConfirming(document);
                            }}
                          >
                            <Trash2 className="size-4" />
                            Borrar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Borrar «{confirming?.title ?? ""}»?</DialogTitle>
            <DialogDescription>
              El agente dejará de poder citarlo de inmediato. Si alguien pregunta por lo que dice
              este documento, responderá que no lo sabe. No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancelar</Button>} />
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const target = confirming;
                setConfirming(null);
                if (target)
                  act(
                    api.deleteDocument(target.id),
                    "Documento borrado. El agente ya no puede citarlo.",
                  );
              }}
            >
              Borrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
};
