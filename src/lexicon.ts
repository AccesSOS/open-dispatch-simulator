/**
 * Vocabulary the value extractors need in order to read a caller's answer.
 *
 * Everything the dispatcher *says* comes from the pack's string catalog. This
 * is the other direction — what the engine has to recognise in what it hears —
 * and it is the same kind of data as a protocol's keywords: language, not
 * logic. The engine ships tables for the locales the corpus speaks so that
 * every pack does not have to restate them, and any pack may override or add a
 * locale with its own `lexicon` block. A pack that declares a word-dependent
 * extractor for a locale nothing covers is rejected at load rather than
 * silently degrading to digits.
 */

export interface Lexicon {
  /** Spoken numerals → value. Longest phrase wins. */
  numbers?: Record<string, number>;
  /** Time-unit words → fraction of a year ("months" → 1/12). */
  ageUnits?: Record<string, number>;
  /** Standalone age words → years ("newborn" → 0). */
  ageTerms?: Record<string, number>;
  /** Words that mark the end (or start) of a street address. */
  streetTypes?: string[];
  /** Words introducing a subunit of an address ("apt", "suite"). */
  unitTypes?: string[];
}

const YEAR = 1;
const MONTH = 1 / 12;
const WEEK = 1 / 52;
const DAY = 1 / 365;
const HOUR = 1 / 8760;

const EN: Lexicon = {
  numbers: {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90,
    a: 1, an: 1, 'a couple': 2, 'a couple of': 2, 'half a dozen': 6, dozen: 12,
  },
  ageUnits: {
    year: YEAR, years: YEAR, yr: YEAR, yrs: YEAR,
    month: MONTH, months: MONTH, mo: MONTH, mos: MONTH,
    week: WEEK, weeks: WEEK, wk: WEEK, wks: WEEK,
    day: DAY, days: DAY,
    hour: HOUR, hours: HOUR,
  },
  // A caller who says "a baby" on the age question should land on the infant
  // card. Infant technique on a child is less effective; adult depth on an
  // infant is dangerous — so the ambiguous words map to the younger card.
  ageTerms: {
    newborn: 0, 'new born': 0, 'just born': 0, neonate: 0,
    infant: 0.5, baby: 0.5,
    toddler: 2,
  },
  streetTypes: [
    'street', 'st', 'avenue', 'ave', 'av', 'road', 'rd', 'lane', 'ln', 'drive',
    'dr', 'boulevard', 'blvd', 'court', 'ct', 'place', 'pl', 'way', 'terrace',
    'ter', 'highway', 'hwy', 'route', 'rte', 'circle', 'cir', 'parkway',
    'pkwy', 'trail', 'alley', 'square', 'crescent', 'close',
  ],
  unitTypes: ['apt', 'apartment', 'unit', 'suite', 'ste', 'floor', 'fl', 'room', 'rm', 'no', 'number'],
};

const ES: Lexicon = {
  numbers: {
    cero: 0, uno: 1, una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
    trece: 13, catorce: 14, quince: 15, dieciséis: 16, dieciseis: 16,
    diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, treinta: 30,
    cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80,
    noventa: 90, 'un par': 2, 'un par de': 2, docena: 12,
  },
  ageUnits: {
    año: YEAR, años: YEAR, ano: YEAR, anos: YEAR,
    mes: MONTH, meses: MONTH,
    semana: WEEK, semanas: WEEK,
    día: DAY, días: DAY, dia: DAY, dias: DAY,
    hora: HOUR, horas: HOUR,
  },
  ageTerms: {
    'recién nacido': 0, 'recien nacido': 0, 'recién nacida': 0, 'recien nacida': 0,
    neonato: 0, lactante: 0.5, bebé: 0.5, bebe: 0.5, 'bebé de meses': 0.5,
  },
  streetTypes: [
    'calle', 'avenida', 'av', 'avda', 'blvd', 'boulevard', 'bulevar', 'paseo',
    'calzada', 'carretera', 'privada', 'andador', 'prolongación', 'prolongacion',
    'camino', 'callejón', 'callejon', 'plaza', 'circuito', 'eje',
  ],
  unitTypes: ['depto', 'departamento', 'apto', 'apartamento', 'interior', 'int', 'piso', 'casa', 'número', 'numero', 'num', 'no'],
};

const FR: Lexicon = {
  numbers: {
    zéro: 0, zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5,
    six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
    treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30,
    quarante: 40, cinquante: 50, soixante: 60,
    'une couple': 2, douzaine: 12,
  },
  ageUnits: {
    an: YEAR, ans: YEAR, année: YEAR, années: YEAR, annee: YEAR, annees: YEAR,
    mois: MONTH,
    semaine: WEEK, semaines: WEEK,
    jour: DAY, jours: DAY,
    heure: HOUR, heures: HOUR,
  },
  ageTerms: {
    'nouveau-né': 0, 'nouveau ne': 0, 'nouveau-nee': 0, 'nouveau-née': 0,
    nouveauné: 0, nourrisson: 0.5, bébé: 0.5, bebe: 0.5,
  },
  streetTypes: [
    'rue', 'avenue', 'av', 'boulevard', 'bd', 'blvd', 'chemin', 'route', 'rte',
    'place', 'impasse', 'allée', 'allee', 'quai', 'cours', 'voie', 'ruelle',
    'montée', 'montee', 'côte', 'cote', 'promenade',
  ],
  unitTypes: ['appartement', 'appart', 'apt', 'app', 'unité', 'unite', 'bureau', 'étage', 'etage', 'numéro', 'numero', 'no'],
};

/** Tables the engine ships. A pack's own `lexicon` overrides these per locale. */
export const DEFAULT_LEXICONS: Record<string, Lexicon> = { en: EN, es: ES, fr: FR };

/** The pack's lexicon for a locale, layered over the shipped default. */
export function lexiconFor(
  locale: string,
  packLexicons: Record<string, Lexicon> | undefined,
): Lexicon {
  const base = DEFAULT_LEXICONS[locale] ?? DEFAULT_LEXICONS[locale.split('-')[0]!] ?? {};
  const override = packLexicons?.[locale];
  return override ? { ...base, ...override } : base;
}
