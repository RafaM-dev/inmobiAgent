import { v7 as uuidv7 } from "uuid";

/**
 * Generación de identificadores como puerto inyectable.
 *
 * Usamos UUID v7: aleatorio pero ordenable por tiempo. Esto importa porque los
 * ids son claves primarias de tablas de altísima inserción (`messages`,
 * `agent_run_steps`) y un UUID v4 fragmenta el índice B-tree de Postgres.
 */
export interface IdGenerator {
  generate(): string;
}

export class UuidV7Generator implements IdGenerator {
  generate(): string {
    return uuidv7();
  }
}

/** Ids predecibles para tests: `test-0001`, `test-0002`… */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;
  constructor(private readonly prefix = "test") {}

  generate(): string {
    this.counter += 1;
    return `${this.prefix}-${String(this.counter).padStart(4, "0")}`;
  }
}
