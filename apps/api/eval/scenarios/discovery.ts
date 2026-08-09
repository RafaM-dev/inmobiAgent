import {
  capturaLead,
  esBreve,
  muestraInmuebles,
  sinInmuebles,
  noEscala,
  recuerda,
  respondeAlgo,
  sinCifrasInventadas,
  sinPromesas,
  usa,
} from "../expectations";
import { scenario } from "../scenario";

/**
 * DESCUBRIMIENTO: de "hola" a saber qué busca el cliente.
 *
 * Es el 80 % de las conversaciones reales y donde un agente se cae más rápido:
 * pregunta lo que ya le han dicho, olvida la ciudad entre dos mensajes, o suelta
 * un catálogo entero antes de saber si el cliente compra o arrienda.
 */
export const discoveryScenarios = [
  scenario({
    id: "descubrimiento-saludo",
    title: "Saludo sin datos",
    why: "Un cliente que escribe «hola» no puede recibir inmuebles al azar ni un interrogatorio.",
    tags: ["descubrimiento"],
    turns: [
      {
        user: "hola",
        expect: [
          respondeAlgo(),
          esBreve(600),
          noEscala(),
          sinCifrasInventadas(),
          sinPromesas(),
        ],
      },
    ],
  }),

  scenario({
    id: "descubrimiento-busqueda-completa",
    title: "Búsqueda con todos los datos en un mensaje",
    why: "Si el cliente da ciudad, operación y presupuesto de golpe, volver a preguntarlos es la forma más rápida de que abandone.",
    tags: ["descubrimiento", "catalogo"],
    turns: [
      {
        user: "busco apartamento en Medellín para arrendar hasta 3 millones",
        expect: [
          respondeAlgo(),
          usa("search_properties"),
          muestraInmuebles(1),
          sinCifrasInventadas(),
          sinPromesas(),
          noEscala(),
        ],
      },
    ],
    then: [recuerda("city", "Medellín"), recuerda("operation")],
  }),

  scenario({
    id: "descubrimiento-por-partes",
    title: "El cliente suelta los datos poco a poco",
    why: "Es como habla la gente por WhatsApp. Si el perfil no acumula entre turnos, el agente vuelve a empezar en cada mensaje.",
    tags: ["descubrimiento", "memoria"],
    turns: [
      { user: "hola, estoy buscando algo", expect: [respondeAlgo(), esBreve(600)] },
      { user: "en Medellín", expect: [respondeAlgo(), sinCifrasInventadas()] },
      {
        user: "para arrendar, hasta 3 millones",
        expect: [respondeAlgo(), sinCifrasInventadas(), sinPromesas()],
      },
    ],
    then: [
      // Lo dicho en el segundo turno tiene que seguir ahí en el cuarto.
      recuerda("city", "Medellín"),
      recuerda("operation"),
    ],
  }),

  scenario({
    id: "descubrimiento-corrige",
    title: "El cliente se corrige",
    why: "«mejor en Bogotá» tiene que ganar a lo dicho antes. Un perfil que no se deja corregir busca en la ciudad equivocada para siempre.",
    tags: ["memoria"],
    turns: [
      { user: "busco apartamento en Medellín para arrendar", expect: [respondeAlgo()] },
      { user: "mejor en Bogotá", expect: [respondeAlgo(), sinCifrasInventadas()] },
    ],
    then: [recuerda("city", "Bogotá")],
  }),

  scenario({
    id: "descubrimiento-crm",
    title: "Ver inmuebles deja ficha en el CRM",
    why: "El lead no depende de que el modelo se acuerde de registrarlo: lo dispara un evento. Si esto falla, la inmobiliaria pierde clientes que sí llegaron.",
    tags: ["catalogo", "crm"],
    turns: [
      {
        // Con TODOS los datos: sin presupuesto, el agente pregunta antes de
        // buscar —que es lo correcto— y no habría inmuebles que mostrar.
        user: "quiero comprar casa en Bogotá hasta 800 millones",
        expect: [respondeAlgo(), usa("search_properties"), sinCifrasInventadas()],
      },
    ],
    then: [capturaLead()],
  }),

  scenario({
    id: "descubrimiento-sin-resultados",
    title: "Búsqueda con todos los datos que no encuentra nada",
    why: "No encontrar nada es un resultado válido y frecuente. Ofrecer «algo parecido» como si fuera lo pedido, o inventar un inmueble para no quedar mal, es el peor fallo posible del producto.",
    tags: ["catalogo", "grounding"],
    turns: [
      {
        // Datos completos —para que la búsqueda se ejecute de verdad— y un
        // presupuesto imposible para una casa en Bogotá.
        user: "busco casa en Bogotá para comprar hasta 5 millones",
        expect: [
          respondeAlgo(),
          sinInmuebles(),
          sinCifrasInventadas(),
          sinPromesas(),
        ],
      },
    ],
  }),
];
