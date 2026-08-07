import { NotFoundError } from "../../../../platform/errors/app-error";

/**
 * Registro de prompts versionados.
 *
 * Un prompt es código: cambia el comportamiento del producto y merece la misma
 * disciplina. Por eso lleva versión explícita y se persiste en cada `AgentRun`
 * — cuando alguien pregunte "¿por qué el bot respondió así el martes?", la
 * respuesta incluye con qué prompt lo hizo.
 *
 * La clave es `(key, version)` y no `(key, locale, version)`: v1 es solo en
 * español (decisión D3). Cuando llegue el eje de idioma en F10, se añade sin
 * romper este contrato porque los consumidores solo piden `key`.
 */
export interface PromptTemplate<TVars> {
  readonly key: string;
  readonly version: string;
  render(vars: TVars): string;
}

export class PromptRegistry {
  private readonly templates = new Map<string, PromptTemplate<never>>();
  private readonly latest = new Map<string, string>();

  register<TVars>(template: PromptTemplate<TVars>): void {
    const id = `${template.key}@${template.version}`;
    if (this.templates.has(id)) {
      throw new Error(`Prompt duplicado: ${id}`);
    }
    this.templates.set(id, template);
    // El último registrado gana como "más reciente": el orden de registro es
    // explícito y está en un solo archivo.
    this.latest.set(template.key, template.version);
  }

  /** Devuelve la versión pedida, o la más reciente si no se especifica. */
  get<TVars>(key: string, version?: string): PromptTemplate<TVars> {
    const resolved = version ?? this.latest.get(key);
    const template = resolved ? this.templates.get(`${key}@${resolved}`) : undefined;
    if (!template) throw new NotFoundError("Prompt", version ? `${key}@${version}` : key);
    return template;
  }

  versionOf(key: string): string {
    const version = this.latest.get(key);
    if (!version) throw new NotFoundError("Prompt", key);
    return version;
  }
}
