import {
  agendaVisita,
  escala,
  noEscala,
  ofreceOpciones,
  respondeAlgo,
  sinCifrasInventadas,
  sinFechasEnElTexto,
  sinPromesas,
  usa,
} from "../expectations";
import { scenario } from "../scenario";

/**
 * VISITAS Y ESCALAMIENTO: el final del embudo, y la salida de emergencia.
 *
 * Agendar es lo que convierte una conversación en negocio, y es donde una
 * alucinación cuesta más caro: un cliente que se presenta un martes que no
 * existe no vuelve a escribir.
 */
export const schedulingScenarios = [
  scenario({
    id: "visita-ofrece-horarios",
    title: "Pedir visita devuelve horarios reales",
    why: "Las franjas las calcula la agenda en la zona horaria de la inmobiliaria. Si el modelo las redacta, tarde o temprano ofrece un hueco ocupado.",
    tags: ["visitas"],
    turns: [
      {
        user: "quiero agendar una visita",
        expect: [
          respondeAlgo(),
          usa("propose_visit_slots"),
          ofreceOpciones(),
          // La comprobación que de verdad importa de este escenario.
          sinFechasEnElTexto(),
          sinPromesas(),
        ],
      },
    ],
  }),

  scenario({
    id: "visita-completa",
    title: "De pedir visita a tenerla agendada",
    why: "Es el objetivo entero de F4: negocio cerrado sin intervención humana. Si se rompe, el producto deja de justificar su precio.",
    tags: ["visitas", "crm"],
    turns: [
      {
        user: "quiero ver el apartamento",
        expect: [respondeAlgo(), ofreceOpciones(), sinFechasEnElTexto()],
      },
      {
        user: "la segunda",
        expect: [respondeAlgo(), usa("schedule_visit"), sinFechasEnElTexto(), sinPromesas()],
      },
    ],
    then: [agendaVisita()],
  }),

  scenario({
    id: "visita-eleccion-ambigua",
    title: "«quiero ver el primero» hablando de inmuebles, no de horarios",
    why: "La misma frase significa dos cosas según lo que hubiera sobre la mesa. Confundirlas agenda una visita que nadie pidió.",
    tags: ["visitas", "ambiguedad"],
    turns: [
      {
        user: "busco apartamento en Medellín para arrendar hasta 3 millones",
        expect: [respondeAlgo(), usa("search_properties")],
      },
      {
        user: "quiero ver el primero",
        expect: [respondeAlgo(), sinFechasEnElTexto(), sinCifrasInventadas()],
      },
    ],
  }),

  scenario({
    id: "escalamiento-explicito",
    title: "El cliente pide hablar con una persona",
    why: "Se resuelve con reglas, sin llamar al modelo: milisegundos y coste cero. Si esto empieza a pasar por el LLM, se paga por algo que no hace falta.",
    tags: ["escalamiento"],
    turns: [
      {
        user: "quiero hablar con una persona",
        expect: [respondeAlgo(), escala(), sinPromesas()],
      },
    ],
  }),

  scenario({
    id: "escalamiento-innecesario",
    title: "Una pregunta normal NO escala",
    why: "Un agente que pasa todo a un asesor no ahorra trabajo: lo duplica. El escalamiento tiene que ser la excepción.",
    tags: ["escalamiento"],
    turns: [
      {
        user: "¿qué apartamentos tienen en Medellín?",
        expect: [respondeAlgo(), noEscala(), sinCifrasInventadas()],
      },
    ],
  }),

  scenario({
    id: "escalamiento-enfado",
    title: "Cliente molesto",
    why: "Insistir con el bot cuando alguien está enfadado empeora la queja. Es un caso donde escalar es lo correcto aunque cueste una conversación.",
    tags: ["escalamiento", "tono"],
    turns: [
      {
        user: "esto es un desastre, llevo tres días esperando respuesta",
        expect: [respondeAlgo(), sinPromesas(), sinCifrasInventadas()],
      },
    ],
  }),
];
