/**
 * Interés por un inmueble concreto.
 *
 * Guardamos la REFERENCIA (`"source:externalId"`), no el inmueble: el catálogo
 * es del proveedor y ya existe un `PropertySnapshot` con la copia de lo que se
 * mostró. Duplicar aquí título y precio sería tener dos verdades que envejecen
 * a distinta velocidad.
 *
 * `timesShown` importa comercialmente: un cliente al que le enseñaron el mismo
 * apartamento tres veces está mucho más cerca de visitar que uno que lo vio de
 * pasada entre otros veinte.
 */
export interface LeadInterest {
  /** Formato `"source:externalId"`. Opaco para este módulo. */
  readonly propertyRef: string;
  readonly firstShownAt: Date;
  readonly lastShownAt: Date;
  readonly timesShown: number;
}

export const newInterest = (propertyRef: string, at: Date): LeadInterest => ({
  propertyRef,
  firstShownAt: at,
  lastShownAt: at,
  timesShown: 1,
});

export const touchInterest = (interest: LeadInterest, at: Date): LeadInterest => ({
  ...interest,
  lastShownAt: at.getTime() > interest.lastShownAt.getTime() ? at : interest.lastShownAt,
  timesShown: interest.timesShown + 1,
});
