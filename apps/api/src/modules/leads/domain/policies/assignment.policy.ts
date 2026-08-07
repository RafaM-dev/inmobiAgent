/**
 * POLÍTICA DE ASIGNACIÓN.
 *
 * Reparto por carga, no por turno rotatorio: un round-robin puro le encaja el
 * decimosexto lead del día al asesor que ya lleva quince abiertos sin cerrar.
 * Aquí gana quien menos leads abiertos tiene, y el desempate es por `id` para
 * que la asignación sea determinista y, por tanto, testeable.
 *
 * Pura a propósito: quién puede recibir leads lo decide `identity`, cuántos
 * tiene abiertos lo cuenta el repositorio, y elegir es esta función. Cambiar el
 * criterio (por especialidad, por zona, por horario) es cambiar solo esto.
 */

export interface AssignmentCandidate {
  readonly userId: string;
  readonly openLeads: number;
}

export const chooseAssignee = (
  candidates: readonly AssignmentCandidate[],
): string | undefined => {
  if (candidates.length === 0) return undefined;

  const best = [...candidates].sort((a, b) =>
    a.openLeads !== b.openLeads ? a.openLeads - b.openLeads : a.userId.localeCompare(b.userId),
  );

  return best[0]?.userId;
};
