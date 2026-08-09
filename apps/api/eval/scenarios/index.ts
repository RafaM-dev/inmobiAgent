import type { EvalScenario } from "../scenario";
import { discoveryScenarios } from "./discovery";
import { knowledgeScenarios } from "./knowledge";
import { schedulingScenarios } from "./scheduling";
import { safetyScenarios } from "./safety";

/**
 * EL CONJUNTO DORADO.
 *
 * Cada escenario es una conversación que un cliente real podría tener, con lo
 * que debería y no debería pasar. Crece hacia arriba: cuando alguien reporta
 * que «el agente contestó una tontería», lo primero es reproducirlo aquí — y
 * entonces el arreglo trae su propio guardián.
 *
 * Los grupos no son decorativos. Responden a preguntas distintas:
 *
 *   descubrimiento  ¿Entiende y recuerda lo que le dicen?
 *   conocimiento    ¿Responde desde los documentos, y calla lo que no está?
 *   visitas         ¿Cierra negocio sin inventar fechas?
 *   seguridad       ¿Se mantiene dentro de lo que puede hacer?
 */
export const allScenarios: readonly EvalScenario[] = [
  ...discoveryScenarios,
  ...knowledgeScenarios,
  ...schedulingScenarios,
  ...safetyScenarios,
];

/** Filtra por etiqueta. Para iterar sobre un área sin correr la suite entera. */
export const scenariosTagged = (tag: string): readonly EvalScenario[] =>
  allScenarios.filter((definition) => definition.tags.includes(tag));
