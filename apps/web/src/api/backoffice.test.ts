import { describe, expect, it, vi } from "vitest";
import { api } from "./backoffice";

/**
 * SUPERFICIE DE LA API DEL PANEL.
 *
 * Lo que se comprueba aquí es la construcción de la petición: la ruta y los
 * parámetros. Suena menor y no lo es — un filtro que no viaja no da error: la
 * pantalla se llena de datos que el asesor cree filtrados y no lo están. Ve
 * *todos* los leads pensando que ve los suyos, o los de esta semana pensando
 * que son los del mes.
 */

/** Captura la URL y las opciones con las que se llamó a `fetch`. */
const capturarFetch = (body: unknown = { items: [], total: 0 }) => {
  const spy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", spy);
  return {
    url: () => (spy.mock.calls[0] as [string, RequestInit])[0],
    init: () => (spy.mock.calls[0] as [string, RequestInit])[1],
  };
};

describe("Peticiones del panel", () => {
  it("sin filtros no añade una cadena de consulta vacía", async () => {
    const fetched = capturarFetch({ conversations: [] });

    await api.inbox().catch(() => undefined);

    // `/api/inbox?` no es lo mismo que `/api/inbox` para una caché ni para un log.
    expect(fetched.url()).toBe("/api/inbox");
  });

  it("los filtros viajan en la consulta", async () => {
    const fetched = capturarFetch({ conversations: [] });

    await api.inbox({ status: "OPEN", mine: true, limit: 25 }).catch(() => undefined);

    const url = new URL(fetched.url(), "http://panel.local");
    expect(url.pathname).toBe("/api/inbox");
    expect(url.searchParams.get("status")).toBe("OPEN");
    expect(url.searchParams.get("mine")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("un filtro sin valor no se envía en vez de enviarse vacío", async () => {
    const fetched = capturarFetch({ leads: [] });

    // `band: ""` es lo que manda un desplegable en su opción "Todas".
    await api.leads({ band: "", mine: false }).catch(() => undefined);

    /*
     * `?band=` no significa "sin filtro": significa "los que tengan la banda
     * vacía", que no es ninguno. Es la diferencia entre una lista completa y
     * una pantalla en blanco que nadie sabe explicar.
     */
    const url = new URL(fetched.url(), "http://panel.local");
    expect(url.searchParams.has("band")).toBe(false);
    expect(url.searchParams.has("status")).toBe(false);
    // `false` SÍ es un valor: "no solo los míos" es una elección del asesor.
    expect(url.searchParams.get("mine")).toBe("false");
  });

  it("las acciones sobre una conversación usan su identificador en la ruta", async () => {
    const fetched = capturarFetch();

    await api.takeover("019fd528-f63e-74de-8fe5-bdd2a45333ac").catch(() => undefined);

    expect(fetched.url()).toBe("/api/inbox/019fd528-f63e-74de-8fe5-bdd2a45333ac/takeover");
    expect(fetched.init().method).toBe("POST");
  });

  it("enviar un mensaje va por POST con el texto en el cuerpo", async () => {
    const fetched = capturarFetch();

    await api.sendMessage("c1", "Hola, soy Ana del equipo").catch(() => undefined);

    expect(fetched.url()).toBe("/api/inbox/c1/messages");
    expect(fetched.init().method).toBe("POST");
    // El texto NUNCA en la URL: acabaría en los logs del servidor y del proxy.
    expect(fetched.init().body).toBe(JSON.stringify({ text: "Hola, soy Ana del equipo" }));
  });

  it("borrar un documento usa DELETE, no un POST disfrazado", async () => {
    const fetched = capturarFetch();

    await api.deleteDocument("doc-1").catch(() => undefined);

    expect(fetched.url()).toBe("/api/knowledge/documents/doc-1");
    expect(fetched.init().method).toBe("DELETE");
  });

  it("guardar la configuración es un PATCH, no un PUT", async () => {
    const fetched = capturarFetch();

    await api.updateSettings({ tone: "FORMAL" }).catch(() => undefined);

    /*
     * El panel manda solo lo que cambió. Con PUT, un campo ausente significaría
     * "bórralo", y guardar el tono borraría el presupuesto mensual.
     */
    expect(fetched.init().method).toBe("PATCH");
    expect(fetched.init().body).toBe(JSON.stringify({ tone: "FORMAL" }));
  });
});
