import type { Property } from "../../../application/ports/property-service";
import { PropertyRef } from "../../../domain/value-objects/property-ref";
import {
  CatalogOperation,
  CatalogPropertyType,
  type CatalogPropertyType as PropertyTypeValue,
} from "../../../domain/value-objects/search-criteria";

/**
 * Dataset semilla del modo demo.
 *
 * Se GENERA de forma determinista en vez de escribirse a mano: doscientos
 * inmuebles literales serían miles de líneas imposibles de revisar, y bastaría
 * un descuido para que un test dependiera de una fila concreta. Aquí, el mismo
 * generador produce siempre exactamente el mismo catálogo, ejecución tras
 * ejecución y máquina tras máquina.
 *
 * El tamaño (240) sale de probarlo: con 120 —la cifra que estimaba el documento
 * de arquitectura— una búsqueda con ciudad, tipo, habitaciones y presupuesto
 * dejaba uno o cero resultados. Como el catálogo se genera, la densidad es
 * gratis; parecer un buscador roto en una demostración, no.
 *
 * Los datos imitan el mercado colombiano real —ciudades, barrios, rangos de
 * precio por zona— porque un dataset irreal esconde problemas que aparecerían
 * el primer día con un cliente: rangos que no filtran, precios que no caben en
 * un mensaje, barrios que el extractor no reconoce.
 */

/** Generador congruente lineal: aleatorio a la vista, determinista de verdad. */
class SeededRandom {
  constructor(private state: number) {}

  private next(): number {
    this.state = (this.state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return this.state / 4_294_967_296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(values: readonly T[]): T {
    return values[Math.floor(this.next() * values.length)] as T;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

/** Barrio con su factor de precio respecto a la media de la ciudad. */
type Neighborhood = readonly [name: string, priceFactor: number];

interface Zone {
  readonly city: string;
  /**
   * Los barrios NO valen lo mismo. En Medellín, El Poblado ronda el doble que
   * Belén; aplicar el precio del Poblado a toda la ciudad producía un catálogo
   * donde ningún presupuesto medio encontraba nada.
   */
  readonly neighborhoods: readonly Neighborhood[];
  /** Precio por m² en pesos, para venta. Refleja diferencias reales por zona. */
  readonly saleM2: number;
  /** Canon mensual por m², para arriendo. */
  readonly rentM2: number;
  /**
   * Peso relativo en el inventario. NO es uniforme a propósito: una
   * inmobiliaria tiene la mayor parte de su cartera en su ciudad y solo algo
   * suelto fuera. Repartir 120 inmuebles a partes iguales entre ocho ciudades
   * dejaba tres o cuatro por ciudad y operación, y cualquier búsqueda con dos
   * filtros salía vacía — un problema del dataset que parecía del buscador.
   */
  readonly weight: number;
}

// Tupla no vacía: así `ZONES[0]` es un `Zone` y no hace falta ninguna
// aserción para el caso por defecto de la selección ponderada.
const ZONES: readonly [Zone, ...Zone[]] = [
  {
    city: "Medellín",
    neighborhoods: [
      ["El Poblado", 1.45],
      ["Laureles", 1.05],
      ["Conquistadores", 0.95],
      ["Estadio", 0.85],
      ["Belén", 0.7],
      ["La América", 0.6],
    ],
    saleM2: 6_400_000,
    rentM2: 26_000,
    weight: 30,
  },
  {
    city: "Bogotá",
    neighborhoods: [
      ["Chicó", 1.4],
      ["Usaquén", 1.15],
      ["Chapinero", 1.0],
      ["Cedritos", 0.85],
      ["Salitre", 0.8],
    ],
    saleM2: 6_800_000,
    rentM2: 29_000,
    weight: 22,
  },
  {
    city: "Envigado",
    neighborhoods: [
      ["Zúñiga", 1.25],
      ["El Esmeraldal", 1.0],
      ["La Magnolia", 0.8],
    ],
    saleM2: 6_000_000,
    rentM2: 24_000,
    weight: 12,
  },
  {
    city: "Cali",
    neighborhoods: [
      ["Ciudad Jardín", 1.3],
      ["Granada", 1.05],
      ["Tequendama", 0.85],
      ["San Antonio", 0.75],
    ],
    saleM2: 4_800_000,
    rentM2: 20_000,
    weight: 10,
  },
  {
    city: "Sabaneta",
    neighborhoods: [
      ["Aves María", 1.1],
      ["Mayorca", 0.95],
      ["Restrepo Naranjo", 0.85],
    ],
    saleM2: 5_400_000,
    rentM2: 22_000,
    weight: 8,
  },
  {
    city: "Barranquilla",
    neighborhoods: [
      ["Riomar", 1.25],
      ["Alto Prado", 1.0],
      ["Villa Country", 0.9],
    ],
    saleM2: 5_200_000,
    rentM2: 22_000,
    weight: 7,
  },
  {
    city: "Cartagena",
    neighborhoods: [
      ["Bocagrande", 1.4],
      ["Castillogrande", 1.25],
      ["Manga", 0.85],
    ],
    saleM2: 7_600_000,
    rentM2: 30_000,
    weight: 5,
  },
  {
    city: "Bucaramanga",
    neighborhoods: [
      ["Cabecera", 1.1],
      ["Sotomayor", 0.95],
    ],
    saleM2: 4_400_000,
    rentM2: 18_000,
    weight: 4,
  },
  {
    city: "Pereira",
    neighborhoods: [
      ["Pinares", 1.1],
      ["Álamos", 0.9],
    ],
    saleM2: 3_900_000,
    rentM2: 16_000,
    weight: 2,
  },
];

const TOTAL_WEIGHT = ZONES.reduce((sum, zone) => sum + zone.weight, 0);

const RESIDENTIAL: readonly PropertyTypeValue[] = [
  CatalogPropertyType.APARTMENT,
  CatalogPropertyType.APARTMENT,
  CatalogPropertyType.APARTMENT,
  CatalogPropertyType.HOUSE,
  CatalogPropertyType.STUDIO,
];

const COMMERCIAL: readonly PropertyTypeValue[] = [
  CatalogPropertyType.OFFICE,
  CatalogPropertyType.COMMERCIAL,
  CatalogPropertyType.WAREHOUSE,
];

const TYPE_LABELS: Record<PropertyTypeValue, string> = {
  APARTMENT: "Apartamento",
  HOUSE: "Casa",
  STUDIO: "Apartaestudio",
  OFFICE: "Oficina",
  COMMERCIAL: "Local comercial",
  LOT: "Lote",
  WAREHOUSE: "Bodega",
  FARM: "Finca",
};

const ALL_FEATURES = [
  "parqueadero",
  "ascensor",
  "balcón",
  "terraza",
  "gimnasio",
  "piscina",
  "portería 24h",
  "zona de lavandería",
  "vista despejada",
  "cocina integral",
  "closets",
  "acepta mascotas",
] as const;

const areaFor = (
  type: PropertyTypeValue,
  operation: string,
  random: SeededRandom,
): number => {
  // El mercado de arriendo es de inmuebles más compactos que el de venta.
  const isRent = operation === CatalogOperation.RENT;

  switch (type) {
    case CatalogPropertyType.STUDIO:
      return random.int(28, 48);
    case CatalogPropertyType.APARTMENT:
      return isRent ? random.int(45, 110) : random.int(55, 150);
    case CatalogPropertyType.HOUSE:
      return isRent ? random.int(90, 200) : random.int(110, 320);
    case CatalogPropertyType.OFFICE:
      return random.int(40, 220);
    case CatalogPropertyType.COMMERCIAL:
      return random.int(35, 180);
    case CatalogPropertyType.WAREHOUSE:
      return random.int(250, 900);
    default:
      return random.int(60, 200);
  }
};

/**
 * Habitaciones según el área, con los umbrales del mercado colombiano: aquí un
 * apartamento de 55 m² con dos alcobas es lo normal, no una rareza. Con
 * umbrales europeos (70 m² para dos alcobas), la búsqueda más común de todas
 * —"dos habitaciones hasta dos millones"— salía vacía.
 */
const bedroomsFor = (type: PropertyTypeValue, area: number, random: SeededRandom): number => {
  if (type === CatalogPropertyType.STUDIO) return 1;
  if (type === CatalogPropertyType.OFFICE) return 0;
  if (type === CatalogPropertyType.COMMERCIAL) return 0;
  if (type === CatalogPropertyType.WAREHOUSE) return 0;
  if (area < 48) return 1;
  if (area < 75) return 2;
  if (area < 110) return random.int(2, 3);
  if (area < 160) return random.int(3, 4);
  return random.int(3, 5);
};

/** Redondea a un múltiplo "de vendedor": 452 130 000 → 450 000 000. */
const roundPrice = (value: number, operation: string): number => {
  const step = operation === CatalogOperation.SALE ? 5_000_000 : 50_000;
  return Math.max(step, Math.round(value / step) * step);
};

/** Selección ponderada: más inventario donde la inmobiliaria opera de verdad. */
const pickZone = (random: SeededRandom): Zone => {
  let ticket = random.int(1, TOTAL_WEIGHT);
  for (const zone of ZONES) {
    ticket -= zone.weight;
    if (ticket <= 0) return zone;
  }
  // Inalcanzable salvo error de redondeo; la primera zona es un valor seguro.
  return ZONES[0];
};

const buildProperty = (index: number, random: SeededRandom, source: string): Property => {
  const zone = pickZone(random);
  const [neighborhood, priceFactor] = random.pick(zone.neighborhoods);
  const operation = random.chance(0.55) ? CatalogOperation.SALE : CatalogOperation.RENT;
  const type = random.chance(0.82) ? random.pick(RESIDENTIAL) : random.pick(COMMERCIAL);

  const areaM2 = areaFor(type, operation, random);
  const bedrooms = bedroomsFor(type, areaM2, random);
  const bathrooms = bedrooms === 0 ? random.int(1, 2) : Math.max(1, bedrooms - random.int(0, 1));

  // Variación por inmueble: dos apartamentos iguales en el mismo barrio no
  // valen lo mismo, y un catálogo donde sí lo valen no ejercita los filtros.
  const variation = 0.78 + random.int(0, 44) / 100;
  const base = operation === CatalogOperation.SALE ? zone.saleM2 : zone.rentM2;
  const amountMajor = roundPrice(areaM2 * base * priceFactor * variation, operation);

  const features: string[] = [];
  for (const feature of ALL_FEATURES) {
    if (random.chance(0.28)) features.push(feature);
  }

  const code = `${type.slice(0, 3)}-${String(index).padStart(4, "0")}`;
  const label = TYPE_LABELS[type];

  return {
    ref: PropertyRef.create(source, code),
    title: `${label} en ${neighborhood}, ${zone.city}`,
    operation,
    type,
    // Unidades mínimas: la misma convención que en toda la plataforma.
    price: { amount: amountMajor * 100, currency: "COP" },
    city: zone.city,
    neighborhood,
    ...(bedrooms > 0 ? { bedrooms } : {}),
    bathrooms,
    areaM2,
    description:
      `${label} de ${String(areaM2)} m² en ${neighborhood}. ` +
      (features.length > 0 ? `Cuenta con ${features.slice(0, 3).join(", ")}.` : "Bien ubicado."),
    features,
  };
};

/**
 * Catálogo simulado completo. El `source` lo inyecta el adaptador para que las
 * referencias digan de dónde vienen.
 */
export const buildSeedCatalog = (source: string, size = 240): readonly Property[] => {
  // Semilla fija: el catálogo es idéntico en cada arranque y en cada máquina.
  const random = new SeededRandom(20260806);
  return Array.from({ length: size }, (_, index) => buildProperty(index + 1, random, source));
};
