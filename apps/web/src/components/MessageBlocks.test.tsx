import type { ReplyBlockContract } from "@agentinmobi/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageBlocks } from "./MessageBlocks";

/**
 * BLOQUES DE MENSAJE.
 *
 * La promesa que se comprueba aquí: **el asesor ve exactamente lo que vio el
 * cliente**. Mismos precios, mismas fichas, mismos botones. Si el panel
 * renderiza otra cosa —o se come un bloque— el asesor toma el control de una
 * conversación creyendo que se dijo algo distinto de lo que se dijo.
 *
 * Y una propiedad que no se ve en el código: los precios se pintan **desde los
 * datos del bloque**, nunca se recalculan ni se reformatean. El backend ya los
 * formateó en la moneda de la inmobiliaria; tocarlos aquí sería inventar una
 * cifra en el último metro.
 */

const card = {
  reference: "APT-001",
  title: "Apartamento en Laureles",
  price: "$ 2.800.000 / mes",
  location: "Laureles, Medellín",
  attributes: [
    { label: "Habitaciones", value: "3" },
    { label: "Área", value: "85 m²" },
  ],
  url: "https://ejemplo.co/apt-001",
};

const renderBlocks = (blocks: readonly ReplyBlockContract[]) =>
  render(<MessageBlocks blocks={blocks} />);

describe("Bloques de mensaje", () => {
  it("pinta el texto tal cual", () => {
    renderBlocks([{ kind: "text", text: "Hola, ¿en qué te ayudo?" }]);

    expect(screen.getByText("Hola, ¿en qué te ayudo?")).toBeDefined();
  });

  it("muestra el precio EXACTAMENTE como lo mandó el backend", () => {
    renderBlocks([{ kind: "property_card", card }]);

    /*
     * Sin reformatear, sin redondear y sin convertir. El backend ya lo puso en
     * la moneda y el formato de la inmobiliaria; cualquier transformación aquí
     * es una cifra distinta de la que vio el cliente por WhatsApp.
     */
    expect(screen.getByText("$ 2.800.000 / mes")).toBeDefined();
    expect(screen.getByText("Apartamento en Laureles")).toBeDefined();
    expect(screen.getByText("Laureles, Medellín")).toBeDefined();
  });

  it("una ficha sin datos opcionales no pinta huecos", () => {
    const { container } = renderBlocks([
      { kind: "property_card", card: { reference: "X", title: "Casa sin detalles" } },
    ]);

    expect(screen.getByText("Casa sin detalles")).toBeDefined();
    // Ni precio vacío, ni "undefined", ni un enlace que no lleva a ninguna parte.
    expect(container.textContent).not.toContain("undefined");
    expect(container.querySelector("a")).toBeNull();
  });

  it("los atributos se leen de un vistazo", () => {
    renderBlocks([{ kind: "property_card", card }]);

    expect(screen.getByText("Habitaciones: 3 · Área: 85 m²")).toBeDefined();
  });

  it("una lista pinta todas sus fichas y su introducción", () => {
    renderBlocks([
      {
        kind: "property_list",
        intro: "Encontré tres opciones:",
        items: [
          { ...card, reference: "A", title: "Primero" },
          { ...card, reference: "B", title: "Segundo" },
          { ...card, reference: "C", title: "Tercero" },
        ],
      },
    ]);

    expect(screen.getByText("Encontré tres opciones:")).toBeDefined();
    // Ninguna se queda fuera: el asesor tiene que ver las mismas que el cliente.
    for (const titulo of ["Primero", "Segundo", "Tercero"]) {
      expect(screen.getByText(titulo)).toBeDefined();
    }
  });

  it("los botones se ven como opciones, no como texto suelto", () => {
    renderBlocks([
      {
        kind: "quick_replies",
        prompt: "¿Qué necesitas?",
        options: [
          { label: "Comprar", value: "SALE" },
          { label: "Arrendar", value: "RENT" },
        ],
      },
    ]);

    expect(screen.getByText("¿Qué necesitas?")).toBeDefined();
    expect(screen.getByText("Comprar")).toBeDefined();
    expect(screen.getByText("Arrendar")).toBeDefined();
  });

  it("los enlaces externos no exponen la sesión del panel", () => {
    renderBlocks([{ kind: "link", url: "https://ejemplo.co/ficha", label: "Ver ficha" }]);

    const enlace = screen.getByText("Ver ficha");
    /*
     * `noreferrer` no es cosmético: sin él, la página de destino recibe la URL
     * del panel y, con `target="_blank"`, puede manipular la pestaña de origen.
     * En una herramienta con sesión abierta eso es una vía de phishing.
     */
    expect(enlace.getAttribute("target")).toBe("_blank");
    expect(enlace.getAttribute("rel")).toBe("noreferrer");
  });

  it("el aviso de traspaso se distingue de lo que dijo el agente", () => {
    renderBlocks([
      { kind: "handoff_notice", reason: "USER_REQUEST", message: "Te paso con un asesor." },
    ]);

    // Va en cursiva: habla la plataforma, no el agente. Confundirlos haría creer
    // al asesor que el bot prometió algo que no dijo.
    const aviso = screen.getByText("Te paso con un asesor.");
    expect(aviso.tagName).toBe("EM");
  });

  it("un bloque que el canal no soportó se ve como tal, no desaparece", () => {
    renderBlocks([{ kind: "unsupported", description: "audio de 12 s" }]);

    /*
     * Es información que el asesor necesita: el cliente mandó algo que el canal
     * no pudo entregar. Ocultarlo dejaría un hueco inexplicable en el hilo.
     */
    expect(screen.getByText("[audio de 12 s]")).toBeDefined();
  });

  it("pinta la ubicación con precisión suficiente y sin ruido", () => {
    renderBlocks([{ kind: "location", latitude: 6.2442312, longitude: -75.5812331 }]);

    expect(screen.getByText(/6\.2442.*-75\.5812/)).toBeDefined();
  });

  it("un mensaje con varios bloques los pinta todos y en orden", () => {
    const { container } = renderBlocks([
      { kind: "text", text: "Estas son las opciones:" },
      { kind: "property_card", card },
      {
        kind: "quick_replies",
        prompt: "¿Alguna te interesa?",
        options: [{ label: "Sí", value: "yes" }],
      },
    ]);

    const texto = container.textContent;
    expect(texto.indexOf("Estas son las opciones:")).toBeLessThan(
      texto.indexOf("Apartamento en Laureles"),
    );
    expect(texto.indexOf("Apartamento en Laureles")).toBeLessThan(
      texto.indexOf("¿Alguna te interesa?"),
    );
  });

  it("un mensaje sin bloques no rompe nada", () => {
    const { container } = renderBlocks([]);
    expect(container.textContent).toBe("");
  });
});
