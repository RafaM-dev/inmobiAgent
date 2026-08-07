import type {
  ConsentState,
  Financing,
  MoneyRange,
  NumberRange,
  PropertyKind,
  PropertyOperation,
  Timeline,
} from "../value-objects/preferences";
import { mergeSlot, type ProfileSlot, type SlotSource } from "../value-objects/profile-slot";

/**
 * Slots de memoria. Cada campo es opcional porque una conversación real empieza
 * sin saber nada y se va llenando.
 */
export interface ProfileSlots {
  name?: ProfileSlot<string>;
  operation?: ProfileSlot<PropertyOperation>;
  propertyType?: ProfileSlot<PropertyKind[]>;
  city?: ProfileSlot<string>;
  neighborhoods?: ProfileSlot<string[]>;
  budget?: ProfileSlot<MoneyRange>;
  bedrooms?: ProfileSlot<number>;
  bathrooms?: ProfileSlot<number>;
  areaM2?: ProfileSlot<NumberRange>;
  features?: ProfileSlot<string[]>;
  timeline?: ProfileSlot<Timeline>;
  financing?: ProfileSlot<Financing>;
  consent?: ProfileSlot<ConsentState>;
}

export type ProfileSlotName = keyof ProfileSlots;

/**
 * Datos que hay que tener antes de buscar (docs §12.1, etapa DISCOVERY).
 * Es una decisión de negocio, no del modelo: por eso está aquí y no en un prompt.
 */
export const REQUIRED_SLOTS: readonly ProfileSlotName[] = [
  "operation",
  "city",
  "propertyType",
  "budget",
];

/** Un cambio de slot ya fusionado: lo que hay que auditar y persistir. */
export interface ProfileChange {
  readonly slot: ProfileSlotName;
  readonly value: unknown;
  readonly source: SlotSource;
  readonly confidence: number;
  readonly updatedAt: Date;
}

export interface ContactProfileProps {
  readonly tenantId: string;
  readonly contactId: string;
  readonly slots: ProfileSlots;
  readonly freeNotes: readonly string[];
  readonly updatedAt: Date;
}

/**
 * MEMORIA ESTRUCTURADA (docs §11).
 *
 * Independiente del proveedor de IA por construcción: aquí no hay embeddings,
 * ni prompts, ni tokens. El LLM propone valores; esta clase decide si los
 * acepta. Cambiar de OpenAI a Ollama no altera ni un dato recordado.
 *
 * `missingRequiredSlots` es lo que convierte "qué le pregunto ahora" en una
 * función pura y determinista, en vez de dejárselo a la creatividad del modelo.
 */
export class ContactProfile {
  private constructor(private props: ContactProfileProps) {}

  static empty(tenantId: string, contactId: string, now: Date): ContactProfile {
    return new ContactProfile({
      tenantId,
      contactId,
      slots: {},
      freeNotes: [],
      updatedAt: now,
    });
  }

  static rehydrate(props: ContactProfileProps): ContactProfile {
    return new ContactProfile(props);
  }

  get tenantId(): string {
    return this.props.tenantId;
  }
  get contactId(): string {
    return this.props.contactId;
  }
  get slots(): Readonly<ProfileSlots> {
    return this.props.slots;
  }
  get freeNotes(): readonly string[] {
    return this.props.freeNotes;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get<K extends ProfileSlotName>(name: K): ProfileSlots[K] {
    return this.props.slots[name];
  }

  /** Datos obligatorios que aún faltan, en orden de preferencia para preguntar. */
  missingRequiredSlots(): readonly ProfileSlotName[] {
    return REQUIRED_SLOTS.filter((name) => this.props.slots[name] === undefined);
  }

  get isReadyToSearch(): boolean {
    return this.missingRequiredSlots().length === 0;
  }

  /**
   * Aplica un conjunto de slots propuestos y devuelve solo los que ganaron la
   * fusión. Ese resultado es lo que se escribe en el histórico auditable.
   */
  apply(proposed: ProfileSlots): ProfileChange[] {
    const changes: ProfileChange[] = [];
    const slots: ProfileSlots = { ...this.props.slots };
    let latest = this.props.updatedAt;

    for (const [name, incoming] of Object.entries(proposed) as [
      ProfileSlotName,
      ProfileSlot<unknown> | undefined,
    ][]) {
      if (!incoming) continue;

      const current = slots[name] as ProfileSlot<unknown> | undefined;
      const winner = mergeSlot(current, incoming);
      if (winner === current) continue;

      // El tipo concreto de cada slot ya lo garantiza `ProfileSlots` en la
      // frontera pública; aquí se recorre de forma homogénea a propósito.
      (slots as Record<string, ProfileSlot<unknown>>)[name] = winner;

      changes.push({
        slot: name,
        value: winner.value,
        source: winner.source,
        confidence: winner.confidence,
        updatedAt: winner.updatedAt,
      });

      if (winner.updatedAt.getTime() > latest.getTime()) latest = winner.updatedAt;
    }

    if (changes.length > 0) {
      this.props = { ...this.props, slots, updatedAt: latest };
    }
    return changes;
  }

  addNote(note: string, now: Date): void {
    const trimmed = note.trim();
    if (trimmed.length === 0 || this.props.freeNotes.includes(trimmed)) return;
    this.props = {
      ...this.props,
      freeNotes: [...this.props.freeNotes, trimmed],
      updatedAt: now,
    };
  }

  snapshot(): ContactProfileProps {
    return { ...this.props, slots: { ...this.props.slots }, freeNotes: [...this.props.freeNotes] };
  }
}
