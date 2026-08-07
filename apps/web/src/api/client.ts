import type { z } from "zod";

/**
 * Cliente HTTP del back-office.
 *
 * Dos decisiones que lo hacen distinto de un `fetch` suelto:
 *
 * 1. **Toda respuesta se valida con el schema del contrato compartido.** Es el
 *    mismo Zod que usa la API para producirla. Si el backend cambia una forma
 *    y el frontend no se entera, el fallo aparece aquí, con nombre y campo, en
 *    vez de tres componentes más abajo como un `undefined is not a function`.
 *
 * 2. **`credentials: "same-origin"`**: la sesión viaja en una cookie `httpOnly`
 *    que este código NO puede leer. No hay token en `localStorage` ni cabecera
 *    `Authorization` que un XSS pueda robar; solo el navegador maneja la cookie.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Sesión caducada o inexistente: hay que volver a la pantalla de acceso. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; correlationId?: string };
}

interface RequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

const parseError = async (response: Response): Promise<ApiError> => {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;

  return new ApiError(
    response.status,
    body?.error?.code ?? "UNKNOWN",
    body?.error?.message ?? `Error ${String(response.status)}`,
    body?.error?.correlationId,
  );
};

const send = async (path: string, options: RequestOptions = {}): Promise<Response> => {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    // Mismo origen: en desarrollo lo garantiza el proxy de Vite.
    credentials: "same-origin",
    ...(options.body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) throw await parseError(response);
  return response;
};

/** Petición con respuesta validada contra el contrato. */
export const request = async <T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> => {
  const response = await send(path, options);
  const payload: unknown = await response.json();

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    // El contrato se rompió: es un fallo de integración, no del usuario.
    throw new ApiError(
      response.status,
      "CONTRACT_MISMATCH",
      `La respuesta de ${path} no cumple el contrato: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  }

  return parsed.data;
};

/** Petición sin cuerpo de respuesta (204). */
export const requestVoid = async (path: string, options: RequestOptions = {}): Promise<void> => {
  await send(path, options);
};
