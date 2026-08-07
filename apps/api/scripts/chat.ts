/**
 * Cliente de chat por terminal.
 *
 * Es un CLIENTE de la API, no parte del servidor: envía por HTTP y escucha por
 * SSE, exactamente igual que hará el web chat del back-office en F7. Esa
 * decisión es deliberada — si el CLI accediera a la base o al contenedor de
 * dependencias, estaríamos probando algo que ningún cliente real hace.
 *
 *   pnpm chat                       (usa la cuenta de consola "demo")
 *   pnpm chat --account demo --as +573001112233
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

interface ReplyBlockLike {
  kind: string;
  text?: string;
  message?: string;
  url?: string;
  label?: string;
  caption?: string;
}

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
};

// 127.0.0.1 y no "localhost": en Windows resuelve a ::1 y la API escucha en IPv4.
const baseUrl = arg("url", `http://127.0.0.1:${process.env["HTTP_PORT"] ?? "3100"}`);
const account = arg("account", "demo");
const from = arg("as", "+573001112233");
const displayName = arg("name", "Cliente Demo");

const endpoint = `${baseUrl}/api/channels/console/${account}`;

const paint = (blocks: ReplyBlockLike[]): void => {
  for (const block of blocks) {
    const text =
      block.text ??
      block.message ??
      (block.url ? `${block.label ?? block.caption ?? ""} ${block.url}`.trim() : "");
    if (text.length > 0) stdout.write(`\n[36m🤖 ${text}[0m\n`);
  }
  stdout.write("\n> ");
};

/** Lector de SSE sobre fetch: sin dependencias, igual que lo hará el navegador. */
const listen = async (signal: AbortSignal): Promise<void> => {
  const response = await fetch(`${endpoint}/stream`, {
    headers: { Accept: "text/event-stream" },
    signal,
  }).catch((error: unknown) => {
    // Cerrar el CLI aborta la petición: eso es una salida limpia, no un fallo.
    if (signal.aborted) return null;
    throw error;
  });

  if (!response) return;

  if (!response.ok || !response.body) {
    throw new Error(
      `No se pudo abrir el flujo (${String(response.status)}). ` +
        "¿Está la API levantada y ejecutado el seed? → pnpm dev && pnpm db:seed",
    );
  }

  // Se tipa a mano porque `getReader()` llega sin tipos útiles sin lib DOM.
  const reader = response.body.getReader() as {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
  };
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (done) return;

    buffer += decoder.decode(value, { stream: true });

    // Los eventos SSE se separan por una línea en blanco.
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const dataLine = part.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;

      const payload = JSON.parse(dataLine.slice(6)) as { blocks?: ReplyBlockLike[] };
      if (payload.blocks) paint(payload.blocks);
    }
  }
};

const send = async (text: string): Promise<void> => {
  const response = await fetch(`${endpoint}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, displayName, text }),
  });

  if (!response.ok) {
    const body = (await response.json()) as { error?: { message?: string } };
    stdout.write(`\n[31m✖ ${body.error?.message ?? response.statusText}[0m\n> `);
  }
};

const main = async (): Promise<void> => {
  const controller = new AbortController();

  stdout.write(`[2mConectando a ${endpoint}…[0m\n`);
  // El catch se engancha ya: si el flujo falla antes de que nadie lo espere,
  // Node lo trataría como rechazo no manejado y tumbaría el proceso.
  const stream = listen(controller.signal).catch((error: unknown) => {
    if (controller.signal.aborted) return;
    stdout.write(`\n[31m✖ ${error instanceof Error ? error.message : String(error)}[0m\n`);
    process.exit(1);
  });

  stdout.write(
    `[2mConectado como ${from}. Escribe y pulsa Enter. Ctrl+C para salir.[0m\n\n> `,
  );

  const rl = createInterface({ input: stdin, output: stdout, terminal: false });

  rl.on("close", () => {
    controller.abort();
  });

  for await (const line of rl) {
    const text = line.trim();
    if (text.length === 0) {
      stdout.write("> ");
      continue;
    }
    if (text === "/salir") break;
    await send(text);
  }

  controller.abort();
  await stream.catch(() => undefined);
};

main().catch((error: unknown) => {
  console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
