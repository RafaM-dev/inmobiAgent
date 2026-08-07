import { DomainError } from "../../../../platform/errors/app-error";

/**
 * Agrupador de documentos: "Políticas", "FAQ", "Proyectos".
 *
 * Existe por dos motivos prácticos, no por taxonomía: permite acotar una
 * búsqueda ("responde solo con las políticas") y permite borrar o reindexar un
 * conjunto entero cuando la inmobiliaria cambia sus condiciones.
 */
export interface KnowledgeCollectionProps {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly slug: string;
  readonly description?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Políticas de Arriendo" → "politicas-de-arriendo". */
export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export class KnowledgeCollection {
  private constructor(private props: KnowledgeCollectionProps) {}

  static create(input: {
    id: string;
    tenantId: string;
    name: string;
    slug?: string;
    description?: string;
    now: Date;
  }): KnowledgeCollection {
    const name = input.name.trim();
    if (name.length === 0) throw new DomainError("La colección necesita un nombre");

    const slug = slugify(input.slug ?? name);
    if (!SLUG_PATTERN.test(slug)) {
      throw new DomainError("El identificador de la colección no es válido", { slug });
    }

    return new KnowledgeCollection({
      id: input.id,
      tenantId: input.tenantId,
      name,
      slug,
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static rehydrate(props: KnowledgeCollectionProps): KnowledgeCollection {
    return new KnowledgeCollection(props);
  }

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get name(): string {
    return this.props.name;
  }
  get slug(): string {
    return this.props.slug;
  }

  rename(name: string, now: Date): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new DomainError("La colección necesita un nombre");
    this.props = { ...this.props, name: trimmed, updatedAt: now };
  }

  snapshot(): KnowledgeCollectionProps {
    return { ...this.props };
  }
}
