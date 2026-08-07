import { TenantContext } from "../../../../platform/tenancy/tenant-context";
import type { TenantDirectory } from "../../../identity";
import {
  DEFAULT_WORKING_HOURS,
  type WorkingHours,
} from "../../domain/policies/business-hours.policy";

/**
 * Parámetros de agenda de una inmobiliaria.
 *
 * Los valores por defecto están en un solo sitio y con su porqué. En F7 serán
 * configurables desde el back-office; hoy son constantes explícitas y no
 * números sueltos repartidos por tres casos de uso.
 */
export const SCHEDULING = {
  /** Una visita a un inmueble no baja de una hora, contando desplazamiento. */
  durationMin: 60,
  /**
   * Antelación mínima. Dos horas es lo que tarda un asesor en reorganizar su
   * mañana; ofrecer algo dentro de diez minutos es ofrecer un plantón.
   */
  minLeadMinutes: 120,
  /** Una semana vista: más allá, el cliente ya no se acuerda de por qué llamó. */
  horizonDays: 7,
  /** Tres opciones. Con más, un chat deja de ser una decisión y pasa a ser una lista. */
  proposalLimit: 3,
  /** Cuánto antes de la visita se envía el recordatorio. */
  reminderHours: 24,
} as const;

export interface SchedulingSettings {
  readonly timezone: string;
  readonly locale: string;
  readonly hours: WorkingHours;
}

/**
 * Zona horaria y horario del tenant en curso. Si la inmobiliaria no configuró
 * horario, se usa el estándar colombiano — nunca "24 horas": ofrecer una visita
 * a las tres de la mañana es peor que no ofrecer ninguna.
 */
export const resolveScheduling = async (
  tenants: TenantDirectory,
): Promise<SchedulingSettings> => {
  const tenant = await tenants.requireActive(TenantContext.requireTenantId());
  return {
    timezone: tenant.timezone,
    locale: tenant.locale,
    hours: tenant.settings.businessHours ?? DEFAULT_WORKING_HOURS,
  };
};
