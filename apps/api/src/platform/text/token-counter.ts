/**
 * Estimación de tokens.
 *
 * Vive en el kernel porque la usan dos módulos con motivos distintos: `agent`
 * para decidir qué cabe en la ventana de contexto y `knowledge` para decidir
 * dónde cortar un documento. Dos estimadores distintos harían que un fragmento
 * "de 500 tokens" midiera una cosa al indexarlo y otra al mandarlo al modelo.
 */
export interface TokenCounter {
  count(text: string): number;
}

/**
 * Estimación por caracteres. Suficiente para decidir recortes de ventana y
 * deliberadamente conservadora: es preferible recortar de más que pasarse del
 * límite del modelo y recibir un error a mitad de una conversación.
 */
export class HeuristicTokenCounter implements TokenCounter {
  /** ~4 caracteres por token en español; se redondea hacia arriba. */
  count(text: string): number {
    return Math.ceil(text.length / 3.5);
  }
}
