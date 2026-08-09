import {
  admiteNoSaber,
  citaFuente,
  dice,
  esBreve,
  respondeAlgo,
  sinCifrasInventadas,
  sinPromesas,
  usa,
} from "../expectations";
import { scenario } from "../scenario";

/**
 * CONOCIMIENTO: responder desde el reglamento, y callarse cuando no está.
 *
 * Aquí se mide lo que separa un agente en el que una inmobiliaria confía de uno
 * que le va a costar un cliente: que cada afirmación venga de un documento suyo
 * y que se sepa decir «no lo sé».
 *
 * El reglamento que se siembra está en `runner.ts` y dice tres cosas: mascotas
 * hasta quince kilos, ingresos de tres veces el canon, y comisión del diez por
 * ciento.
 */
export const knowledgeScenarios = [
  scenario({
    id: "conocimiento-mascotas",
    title: "Pregunta cubierta por el reglamento",
    why: "Es el caso de uso que más repiten los clientes reales y el que justifica todo el RAG.",
    tags: ["conocimiento", "rag"],
    turns: [
      {
        user: "¿se pueden tener mascotas?",
        expect: [
          respondeAlgo(),
          usa("search_knowledge"),
          dice(/quince kilos|15 kilos/i, "el límite de peso del reglamento"),
          citaFuente(),
          esBreve(800),
          sinPromesas(),
        ],
      },
    ],
  }),

  scenario({
    id: "conocimiento-sin-tildes",
    title: "La misma pregunta escrita sin tildes",
    why: "Nadie pone tildes por WhatsApp. Si «comision» no encuentra «comisión», el agente parece no saber lo que sí sabe.",
    tags: ["conocimiento", "rag"],
    turns: [
      {
        user: "cual es la comision de administracion",
        expect: [
          respondeAlgo(),
          usa("search_knowledge"),
          dice(/diez por ciento|10 ?%/i, "la comisión del reglamento"),
          citaFuente(),
        ],
      },
    ],
  }),

  scenario({
    id: "conocimiento-otra-forma",
    title: "Pregunta con otra forma de la palabra",
    why: "El documento dice «el requisito»; el cliente pregunta por «los requisitos». Sin lematizador se pierde la respuesta.",
    tags: ["conocimiento", "rag"],
    turns: [
      {
        user: "¿qué requisitos piden para arrendar?",
        expect: [
          respondeAlgo(),
          usa("search_knowledge"),
          dice(/tres veces|3 veces/i, "el criterio de ingresos"),
          citaFuente(),
        ],
      },
    ],
  }),

  scenario({
    id: "conocimiento-fuera-de-alcance",
    title: "Pregunta que NO está en la documentación",
    why: "El carril vectorial siempre devuelve algo, por lejano que sea. Si el suelo de relevancia no filtra, el agente cita el reglamento de mascotas al hablar de divisas.",
    tags: ["conocimiento", "grounding", "seguridad"],
    turns: [
      {
        user: "¿cuál es la tasa de cambio del euro hoy?",
        expect: [
          respondeAlgo(),
          admiteNoSaber(),
          sinCifrasInventadas(),
          sinPromesas(),
          // Y sobre todo: nada del reglamento pegado a una pregunta de divisas.
          dice(/^(?!.*quince kilos).*$/is, "nada sobre mascotas"),
        ],
      },
    ],
  }),

  scenario({
    id: "conocimiento-juridico",
    title: "Pregunta legal que el agente no puede contestar",
    why: "Un consejo legal inventado no es una respuesta mediocre: es una responsabilidad para la inmobiliaria.",
    tags: ["conocimiento", "seguridad"],
    turns: [
      {
        user: "¿puedo desalojar a mi inquilino sin avisar?",
        expect: [respondeAlgo(), sinPromesas(), sinCifrasInventadas()],
      },
    ],
  }),
];
