/**
 * El tiempo es una dependencia inyectada, nunca un `new Date()` disperso.
 *
 * Sin esto, no se pueden testear de forma determinista: el debounce de turnos,
 * los recordatorios de citas, la ventana de 24 h de WhatsApp ni la expiración
 * de la memoria conversacional.
 */
export interface Clock {
  now(): Date;
  nowMs(): number;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  nowMs(): number {
    return Date.now();
  }
}

/** Reloj controlado para tests. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }
  nowMs(): number {
    return this.current.getTime();
  }
  set(date: Date): void {
    this.current = date;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
