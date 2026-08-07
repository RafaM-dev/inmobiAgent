/**
 * Documentación de la inmobiliaria de demostración.
 *
 * Son documentos REALISTAS del mercado colombiano, no texto de relleno, por la
 * misma razón que el catálogo simulado tiene precios verosímiles: un corpus
 * irreal esconde los problemas que aparecerían el primer día con un cliente
 * —preguntas que no encuentran nada, fragmentos que mezclan temas, citas que no
 * convencen—. Aquí, las tres preguntas más habituales de un arrendatario tienen
 * respuesta y se puede comprobar.
 *
 * El formato es Markdown a propósito: los epígrafes son lo que permite que cada
 * sección sea un fragmento propio y que la cita diga de qué apartado salió.
 */

export interface DemoDocument {
  readonly collection: string;
  readonly title: string;
  readonly text: string;
}

export const DEMO_DOCUMENTS: readonly DemoDocument[] = [
  {
    collection: "Políticas",
    title: "Requisitos para arrendar",
    text: `# Requisitos para arrendar

## Documentos del solicitante

Cédula de ciudadanía ampliada al 150 %, certificado laboral con menos de treinta
días de expedición y los tres últimos desprendibles de pago. Los independientes
presentan declaración de renta del último año y extractos bancarios de los
últimos tres meses.

## Capacidad de pago

Los ingresos del solicitante deben equivaler al menos a tres veces el canon
mensual. Si no se alcanza ese tope, se puede sumar el ingreso de un coarrendatario
que firme el contrato.

## Codeudor y póliza

Se acepta codeudor con finca raíz libre de gravámenes en la misma ciudad, o en su
defecto una póliza de arrendamiento con una aseguradora autorizada. El estudio de
la solicitud tarda entre uno y tres días hábiles.

## Depósito y primer pago

No se cobra depósito en arriendo de vivienda urbana. El primer canon se paga al
firmar el contrato, junto con la cuota de administración del mes en curso si el
inmueble está en propiedad horizontal.
`,
  },
  {
    collection: "Políticas",
    title: "Reglamento de convivencia",
    text: `# Reglamento de convivencia

## Mascotas

Se permiten mascotas de hasta quince kilos en las unidades residenciales, previa
autorización escrita de la administración. No se admiten razas clasificadas como
potencialmente peligrosas. El propietario de la mascota responde por los daños
que cause en zonas comunes.

## Ruido y horarios

Las obras y remodelaciones se autorizan de lunes a viernes entre las ocho de la
mañana y las cinco de la tarde, y los sábados hasta el mediodía. No se permiten
reuniones con música amplificada después de las once de la noche.

## Parqueadero de visitantes

El parqueadero de visitantes tiene un máximo de doce horas continuas y no se
puede usar como parqueadero permanente de residentes. Se registra la placa en
portería.

## Terminación anticipada

El arrendatario puede terminar el contrato con sesenta días de preaviso escrito.
La terminación sin preaviso genera una indemnización equivalente a tres cánones
mensuales, según lo pactado en el contrato.
`,
  },
  {
    collection: "Políticas",
    title: "Proceso de compra de vivienda",
    text: `# Proceso de compra de vivienda

## Separación del inmueble

La separación se formaliza con una promesa de compraventa y un pago de arras que
suele ser el diez por ciento del valor. Las arras son confirmatorias salvo pacto
en contrario.

## Estudio de títulos

Antes de la escrituración se revisa el certificado de tradición y libertad de los
últimos veinte años, el paz y salvo de administración y el estado del impuesto
predial. El estudio lo hace el abogado de la entidad financiera cuando hay
crédito.

## Gastos de escrituración

Los gastos notariales se reparten por mitades entre comprador y vendedor. El
impuesto de registro y la beneficencia los asume el comprador. El retención en la
fuente la asume el vendedor.

## Crédito hipotecario

La aprobación de un crédito hipotecario tarda entre quince y treinta días
hábiles. El banco financia hasta el setenta por ciento del valor comercial en
vivienda no VIS.
`,
  },
];

export const DEMO_COLLECTION_SOURCE = {
  sourceType: "TEXT",
  mimeType: "text/markdown",
} as const;
