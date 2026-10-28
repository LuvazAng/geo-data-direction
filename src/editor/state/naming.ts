import {
  buildName,
  compareNames,
  endpointColonias,
  evaluateName,
  validSiglas,
  type ColoniaIndex,
  type ColoniaProps,
  type NameComparison,
  type NameContext,
  type NameEvaluation,
} from '@core';
import type { PlaceToAbbreviate } from '@protocol';
import { baseName } from '../services/files';
import { coordsOf, type Route } from '../services/route';

// Nombre de un trazo que se resuelve a mano: de qué colonia a qué colonia va, cómo se llama hoy y cómo se llamaría con la
// regla RUTA-ORIGEN-DESTINO. Qué siglas lleva cada colonia lo responde el servidor; aquí se arma y se evalúa el nombre.

/** Una colonia, tal como se muestra y tal como se le pide al servidor. */
export interface PlaceRef {
  /** Sin el tipo («Tierra Larga»): con ella se buscan las siglas y se revisa si un nombre la menciona. */
  nombre: string;
  tipo: string;
  municipio: string;
}

const placeOf = (c: ColoniaProps | null): PlaceRef | null => (c ? { nombre: c.nombre, tipo: c.tipo, municipio: c.municipio } : null);

export interface NameSubject {
  id: string;
  letter: string;
  color: string;
  /** El nombre con que venía en el KML. */
  original: string;
  /** El que tiene ahora en el editor (puede ser ya una sugerencia del orquestador). */
  actual: string;
  /** Dónde empieza y dónde termina el trazo, en el sentido en que va ahora; null si ese extremo no cae en ninguna colonia. */
  inicio: PlaceRef | null;
  final: PlaceRef | null;
}

export function subjectOf(route: Route, index: ColoniaIndex): NameSubject {
  const { inicio, final } = endpointColonias(coordsOf(route), index);
  return {
    id: route.id,
    letter: route.letter,
    color: route.color,
    original: route.parsed.name || baseName(route.source.file.name),
    actual: route.outName,
    inicio: placeOf(inicio),
    final: placeOf(final),
  };
}

/** El trazo y los demás de su dupla (la ida y el regreso se nombran juntos para que compartan siglas). Sin alternas. */
export function nameGroup(id: string, routes: Route[], duplaOf: Record<string, number | undefined>): string[] {
  const dupla = duplaOf[id];
  const mates = dupla === undefined ? [] : routes.filter((r) => r.id !== id && !r.alt && duplaOf[r.id] === dupla).map((r) => r.id);
  return [id, ...mates];
}

/** Las colonias de los trazos, sin repetir, tal como se piden al servidor. */
export function placesToAbbreviate(subjects: NameSubject[]): PlaceToAbbreviate[] {
  const seen = new Map<string, PlaceToAbbreviate>();
  for (const s of subjects)
    for (const p of [s.inicio, s.final]) if (p && !seen.has(p.nombre)) seen.set(p.nombre, { nombre: p.nombre, tipo: p.tipo, municipio: p.municipio });
  return [...seen.values()];
}

export interface NameCandidate {
  clave: 'original' | 'actual' | 'propuesta';
  titulo: string;
  nombre: string;
  evaluacion: NameEvaluation;
}

export interface NameReport {
  /** La propuesta, o null si faltan siglas válidas de alguna colonia. */
  propuesta: string | null;
  candidatos: NameCandidate[];
  /** La propuesta contra el mejor de los nombres que ya había. */
  comparacion: NameComparison | null;
}

/**
 * Compara el nombre original, el actual y la propuesta de cada trazo. `siglas` da las de una colonia (las del servidor o las que
 * se escribieron a mano). Un trazo cuyo inicio o final no cae en ninguna colonia no tiene informe (null).
 */
export function reportsFor(
  subjects: NameSubject[],
  allNames: Record<string, string>,
  ruta: string,
  siglas: (lugar: string) => string,
): Map<string, NameReport | null> {
  const proposals = new Map<string, string | null>(
    subjects.map((s) => {
      const a = s.inicio ? siglas(s.inicio.nombre) : '';
      const b = s.final ? siglas(s.final.nombre) : '';
      return [s.id, s.inicio && s.final && validSiglas(a) && validSiglas(b) ? buildName(ruta, a, b) : null];
    }),
  );
  const reports = new Map<string, NameReport | null>();
  for (const s of subjects) {
    if (!s.inicio || !s.final) {
      reports.set(s.id, null);
      continue;
    }
    // un nombre es de otro trazo si ya lo lleva otro del editor o si es la propuesta de otro de la dupla
    const ocupados = new Set<string>([
      ...Object.entries(allNames)
        .filter(([id]) => id !== s.id)
        .map(([, name]) => name),
      ...[...proposals].filter(([id, p]) => id !== s.id && p).map(([, p]) => p!),
    ]);
    const ctx: NameContext = {
      ruta,
      inicio: { lugar: s.inicio.nombre, siglas: siglas(s.inicio.nombre) },
      final: { lugar: s.final.nombre, siglas: siglas(s.final.nombre) },
      ocupados,
    };
    const propuesta = proposals.get(s.id) ?? null;
    const candidatos: NameCandidate[] = [{ clave: 'original', titulo: 'Original', nombre: s.original, evaluacion: evaluateName(s.original, ctx) }];
    // el nombre actual sólo es otro candidato si no es ya el original ni la propuesta (que se muestra aparte)
    if (s.actual !== s.original && s.actual !== propuesta)
      candidatos.push({ clave: 'actual', titulo: 'Actual', nombre: s.actual, evaluacion: evaluateName(s.actual, ctx) });
    let comparacion: NameComparison | null = null;
    if (propuesta && propuesta !== s.original) {
      const evaluacion = evaluateName(propuesta, ctx);
      const best = candidatos.reduce((a, b) => (b.evaluacion.cumple > a.evaluacion.cumple ? b : a));
      candidatos.push({ clave: 'propuesta', titulo: 'Propuesta', nombre: propuesta, evaluacion });
      comparacion = compareNames(best.evaluacion, evaluacion);
    }
    reports.set(s.id, { propuesta, candidatos, comparacion });
  }
  return reports;
}
