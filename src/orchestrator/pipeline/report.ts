import type { PageResult } from '../domain/classify';
import type { OrqConfig } from '../config';
import type { DownloadSummary } from '../io/download';
import type { Vote } from '../domain/labeled';
import type { RouteCode } from '../domain/naming';
import type { OutputSummary } from '../io/output';
import type { PairMetrics } from '../domain/similarity';
import type { SourceScan } from '../io/source';
import type { BatchState } from '../io/store';
import type { TraceInfo } from '../domain/traces';
import type { TraceRow } from '@protocol';

export interface Report {
  lote: string;
  zona: string;
  fuente: string;
  inicio: string;
  fin: string;
  duracionMs: number;
  tiempos: Record<string, number>;
  configuracion: Record<string, unknown>;
  resumen: Record<string, number>;
  paginas: {
    slug: string;
    titulo: string;
    mapas: number;
    estado: string;
    error?: string;
    diagnostico?: string;
    codigoRuta?: RouteCode;
    terminal?: string | null;
  }[];
  mapas: {
    id: string;
    ruta: string;
    orden: number;
    titulo: string;
    url: string;
    estado: string;
    error?: string;
    nombreServidor?: string;
    sha256?: string;
    descargadoEn?: string;
    trazos: number;
  }[];
  trazos: TraceRow[];
  duplicados: (PairMetrics & { rutaA: string; rutaB: string; tituloA: string; tituloB: string })[];
  etiquetados: {
    total: number;
    emparejados: number;
    coincideSentido: number;
    coincideNombre: number;
    detalle: {
      archivo: string;
      traza: string | null;
      similitud: number | null;
      sentido: string | null;
      nombreGenerado: string | null;
      coincideSentido: boolean | null;
      coincideNombre: boolean | null;
      /** coincide / difiere: lo decidido por el orquestador contra el nombre del usuario; no-verificable: el código no se parece al nombre. */
      validacion: string;
      nota: string;
    }[];
  };
  ia: {
    habilitada: boolean;
    disponible: boolean;
    detalle: string;
    consultas: number;
    enCache: number;
    aplicadas: number;
    errores: number;
    intervenciones: {
      mapa: string;
      titulo: string;
      ms: number;
      enCache: boolean;
      error?: string;
      descartes: string[];
      cambios: string[];
      explicacion: string;
    }[];
  };
  codigos: {
    rutas: (RouteCode & { slug: string })[];
    sugeridos: { nombre: string; codigo: string }[];
    viasSugeridas: { nombre: string; codigo: string }[];
    conflictos: { lugar: string; codigos: Vote[] }[];
  };
  salida: OutputSummary | null;
  errores: string[];
}

interface BuildArgs {
  cfg: OrqConfig;
  scan: SourceScan;
  state: BatchState;
  dl: DownloadSummary;
  started: Date;
  tiempos: Record<string, number>;
  errores: string[];
  pages: PageResult[];
  traces: TraceInfo[];
  rows: TraceRow[];
  extra: Partial<{
    ia: Report['ia'];
    duplicados: PairMetrics[];
    candidatos: number;
    etiquetados: Report['etiquetados']['detalle'];
    rutas: Report['codigos']['rutas'];
    codigosSugeridos: Report['codigos']['sugeridos'];
    viasSugeridas: Report['codigos']['viasSugeridas'];
    conflictosCodigos: Report['codigos']['conflictos'];
    salida: OutputSummary;
    descargaDuplicados: DownloadSummary['duplicados'];
  }>;
}

export function buildReport(a: BuildArgs): Report {
  const fin = new Date();
  const { rows, scan, state } = a;
  const principal = rows.filter((r) => r.rol === 'principal' && !r.duplicadoDe);
  const byRef = new Map(scan.maps.map((m) => [m.id, m]));
  const routes = new Map((a.extra.rutas ?? []).map((r) => [r.slug, r]));
  const labeled = a.extra.etiquetados ?? [];
  const mapStates = Object.values(state.mapas);
  return {
    lote: a.cfg.lote,
    zona: a.cfg.zona,
    fuente: a.cfg.fuente.url,
    inicio: a.started.toISOString(),
    fin: fin.toISOString(),
    duracionMs: fin.getTime() - a.started.getTime(),
    tiempos: a.tiempos,
    configuracion: {
      archivo: a.cfg.origen,
      estrategia: a.cfg.fuente.estrategia,
      subpaginas: a.cfg.fuente.subpaginas,
      similitud: a.cfg.similitud,
      nomenclatura: {
        patron: a.cfg.nomenclatura.patron,
        incluirVia: a.cfg.nomenclatura.incluirVia,
        codigoNuevo: a.cfg.nomenclatura.codigoNuevo,
        colision: a.cfg.nomenclatura.colision,
      },
      ia: { habilitada: a.cfg.ia.habilitada, modelo: a.cfg.ia.modelo, url: a.cfg.ia.url },
    },
    resumen: {
      paginas: scan.pages.length,
      paginasConError: scan.pages.filter((p) => p.status === 'error').length,
      mapasEncontrados: scan.maps.length,
      descargadosEnEstaCorrida: a.dl.descargados,
      yaDescargados: a.dl.yaEstaban,
      mapasConError: mapStates.filter((m) => m.estado === 'ERROR').length,
      mapasGenerados: mapStates.filter((m) => m.estado === 'GENERADO').length,
      mapasEnRevision: mapStates.filter((m) => m.estado === 'REQUIERE_REVISION').length,
      mapasDescartados: mapStates.filter((m) => m.estado === 'DESCARTADO').length,
      trazos: rows.length,
      itinerariosPrincipales: principal.length,
      generados: rows.filter((r) => r.estado === 'GENERADO').length,
      requierenRevision: rows.filter((r) => r.estado === 'REQUIERE_REVISION').length,
      tramosCortos: rows.filter((r) => r.rol === 'tramo').length,
      ampliaciones: rows.filter((r) => r.rol === 'ampliacion').length,
      bases: rows.filter((r) => r.rol === 'base').length,
      sinIdentificar: rows.filter((r) => r.rol === 'otro').length,
      duplicadosDentroDelMapa: rows.filter((r) => r.duplicadoDe).length,
      reasignados: rows.filter((r) => r.mapa !== r.mapaAsignado).length,
      posiblesDuplicadosEntreMapas: (a.extra.duplicados ?? []).length,
      paresComparados: a.extra.candidatos ?? 0,
    },
    paginas: scan.pages.map((p) => ({
      slug: p.slug,
      titulo: p.title,
      mapas: p.maps,
      estado: p.status,
      error: p.error,
      diagnostico: p.diagnostic,
      codigoRuta: routes.get(p.slug),
      terminal: a.pages.find((x) => x.slug === p.slug)?.hub ?? null,
    })),
    mapas: scan.maps.map((m) => {
      const s = state.mapas[m.id];
      return {
        id: m.id,
        ruta: m.pageSlug,
        orden: m.order,
        titulo: m.title,
        url: m.downloadUrl,
        estado: s?.estado ?? 'PENDIENTE',
        error: s?.error,
        nombreServidor: s?.nombreServidor,
        sha256: s?.sha256,
        descargadoEn: s?.descargadoEn,
        trazos: rows.filter((r) => r.mapa === m.id).length,
      };
    }),
    trazos: rows,
    duplicados: (a.extra.duplicados ?? []).map((d) => {
      const ra = byRef.get(d.a.split('#')[0]);
      const rb = byRef.get(d.b.split('#')[0]);
      return { ...d, rutaA: ra?.pageSlug ?? '', rutaB: rb?.pageSlug ?? '', tituloA: ra?.title ?? '', tituloB: rb?.title ?? '' };
    }),
    etiquetados: {
      total: labeled.length,
      emparejados: labeled.filter((l) => l.traza).length,
      coincideSentido: labeled.filter((l) => l.coincideSentido).length,
      coincideNombre: labeled.filter((l) => l.coincideNombre).length,
      detalle: labeled,
    },
    ia: a.extra.ia ?? {
      habilitada: a.cfg.ia.habilitada,
      disponible: false,
      detalle: 'no se ejecutó',
      consultas: 0,
      enCache: 0,
      aplicadas: 0,
      errores: 0,
      intervenciones: [],
    },
    codigos: {
      rutas: a.extra.rutas ?? [],
      sugeridos: a.extra.codigosSugeridos ?? [],
      viasSugeridas: a.extra.viasSugeridas ?? [],
      conflictos: a.extra.conflictosCodigos ?? [],
    },
    salida: a.extra.salida ?? null,
    errores: [...a.errores, ...scan.diagnostics],
  };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n * 100)} %`);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function table(head: string[], rows: unknown[][]): string {
  if (rows.length === 0) return '_(ninguno)_\n';
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n') + '\n';
}

const end = (e: TraceRow['inicio']) =>
  e.localidad ? `${e.localidad}${e.distanciaM ? ` (${e.distanciaM} m)` : ''}` : e.municipio ? `mpio. ${e.municipio}` : '—';

export function renderMarkdown(r: Report): string {
  const s = r.resumen;
  const out: string[] = [];
  out.push(`# Reporte del orquestador — lote ${r.lote}`);
  out.push('');
  out.push(`- **Fuente:** ${r.fuente}`);
  out.push(`- **Ejecución:** ${r.inicio} → ${r.fin} (${secs(r.duracionMs)})`);
  out.push(
    `- **Tiempos:** ${Object.entries(r.tiempos)
      .map(([k, v]) => `${k} ${secs(v)}`)
      .join(' · ')}`,
  );
  out.push(
    `- **IA:** ${r.ia.habilitada ? `${r.ia.detalle}; ${r.ia.consultas} consulta(s) (${r.ia.enCache} en caché), ${r.ia.aplicadas} propuesta(s) aceptada(s), ${r.ia.errores} error(es)` : r.ia.detalle}`,
  );
  out.push('');
  out.push('## Resumen');
  out.push('');
  out.push(
    table(
      ['Concepto', 'Cantidad'],
      [
        ['Subpáginas', `${s.paginas} (${s.paginasConError} con error)`],
        ['Mapas encontrados', s.mapasEncontrados],
        ['Descargados en esta corrida / ya estaban', `${s.descargadosEnEstaCorrida} / ${s.yaDescargados}`],
        ['Mapas inaccesibles o inválidos', s.mapasConError],
        ['Mapas listos / en revisión', `${s.mapasGenerados} / ${s.mapasEnRevision}`],
        ['Trazos analizados', s.trazos],
        ['Itinerarios principales', s.itinerariosPrincipales],
        ['**Archivos generados**', `**${s.generados}**`],
        ['**Requieren revisión**', `**${s.requierenRevision}**`],
        ['Tramos cortos / ampliaciones / bases (no se generan)', `${s.tramosCortos} / ${s.ampliaciones} / ${s.bases}`],
        ['Trazos sin identificar', s.sinIdentificar],
        ['Trazos repetidos dentro del mismo mapa', s.duplicadosDentroDelMapa],
        ['Trazos publicados en otro mapa (reasignados)', s.reasignados],
        ['Posibles duplicados entre mapas', s.posiblesDuplicadosEntreMapas],
      ],
    ),
  );

  const errMaps = r.mapas.filter((m) => m.estado === 'ERROR');
  out.push('## Mapas inaccesibles o inválidos');
  out.push('');
  out.push(
    table(
      ['Ruta', 'Mapa', 'Error'],
      errMaps.map((m) => [m.ruta, m.titulo, m.error]),
    ),
  );

  const review = r.trazos.filter((t) => t.estado === 'REQUIERE_REVISION');
  out.push(`## Requieren revisión (${review.length})`);
  out.push('');
  out.push('Copias en `resultados/_REVISION/` para abrirlas en el editor (`npm run dev`).');
  out.push('');
  out.push(
    table(
      ['Ruta', 'Mapa', 'Trazo', 'DESCRIPCIO', 'Inicio → Final', 'Sentido', 'Nombre propuesto', 'Motivo'],
      review.map((t) => [
        t.ruta,
        t.tituloMapa,
        t.indice,
        t.descripcion || t.nombreOriginal,
        `${end(t.inicio)} → ${end(t.final)}`,
        t.sentido,
        t.nombrePropuesto ?? '—',
        t.motivosRevision.join('; '),
      ]),
    ),
  );

  out.push('## Archivos generados');
  out.push('');
  for (const p of r.paginas) {
    const gen = r.trazos.filter((t) => t.ruta === p.slug && t.estado === 'GENERADO').sort((a, b) => (a.duplaN ?? 0) - (b.duplaN ?? 0) || a.indice - b.indice);
    if (!gen.length) continue;
    const rc = p.codigoRuta;
    out.push(
      `### ${p.titulo || p.slug} — \`${rc?.codigo}\`${rc?.origen === 'sugerido' ? ' (código sugerido)' : ''}${p.terminal ? ` · terminal: ${p.terminal}` : ''}`,
    );
    out.push('');
    out.push(
      table(
        [
          'Dupla',
          'Archivo',
          'Origen → Destino',
          'Vía',
          'Inicio → Final (INEGI)',
          'Sentido',
          'Similitud dupla',
          'Método',
          'Resolución manual',
          'DESCRIPCIO original',
        ],
        gen.map((t) => [
          t.duplaN,
          t.nombreFinal,
          `${t.origen} → ${t.destino}`,
          t.via ?? '',
          `${end(t.inicio)} → ${end(t.final)}`,
          `${t.sentido} (${t.puntaje > 0 ? '+' : ''}${t.puntaje})`,
          t.similitudDupla ? `${pct(t.similitudDupla.similitud)} ${t.similitudDupla.clase}` : '—',
          t.metodo,
          t.resolucionManual
            ? `${t.resolucionManual.estado === 'descartado' ? 'descartado' : (t.resolucionManual.tipo ?? 'generado')}${t.resolucionManual.nota ? `: ${t.resolucionManual.nota}` : ''}`
            : '—',
          t.descripcion || t.nombreOriginal,
        ]),
      ),
    );
  }

  out.push('## Comparación con GEODATA/RUTAS (casos etiquetados)');
  out.push('');
  const e = r.etiquetados;
  const decided = e.detalle.filter((d) => d.validacion === 'coincide' || d.validacion === 'difiere').length;
  out.push(
    `${e.emparejados} de ${e.total} archivos existentes tienen un trazo equivalente en la fuente. De los ${decided} que el orquestador decidió por su cuenta, el origen y destino coinciden con tu nombre en ${e.coincideSentido}; el nombre completo (sin el código de ruta) coincide en ${e.coincideNombre}.`,
  );
  out.push('');
  out.push(
    table(
      ['Archivo existente', 'Similitud', 'Orden de coordenadas', 'Validación', 'Nombre generado', '¿Nombre igual?', 'Nota'],
      e.detalle.map((d) => [
        d.archivo,
        pct(d.similitud),
        d.sentido ?? '—',
        d.validacion === 'difiere' ? '**difiere**' : d.validacion,
        d.nombreGenerado ?? '—',
        d.coincideNombre === null ? '—' : d.coincideNombre ? 'sí' : 'no',
        d.nota,
      ]),
    ),
  );

  out.push('## Códigos');
  out.push('');
  out.push('### Rutas');
  out.push('');
  out.push(
    table(
      ['Subpágina', 'Código', 'Carpeta', 'Origen del código', 'Nota'],
      r.codigos.rutas.map((x) => [x.slug, x.codigo, x.carpeta, x.origen, x.nota ?? '']),
    ),
  );
  out.push('### Localidades con código sugerido (revisar y fijar en `nomenclatura.localidades`)');
  out.push('');
  out.push(
    table(
      ['Lugar', 'Código sugerido'],
      r.codigos.sugeridos.map((x) => [x.nombre, x.codigo]),
    ),
  );
  out.push('### Vías con código sugerido (`nomenclatura.vias`)');
  out.push('');
  out.push(
    table(
      ['Vía', 'Código sugerido'],
      r.codigos.viasSugeridas.map((x) => [x.nombre, x.codigo]),
    ),
  );
  out.push('### Lugares con más de un código en GEODATA/RUTAS');
  out.push('');
  out.push(
    table(
      ['Lugar', 'Códigos (votos)', 'Se usa'],
      r.codigos.conflictos.map((c) => [c.lugar, c.codigos.map((v) => `${v.codigo} (${v.votos}: ${v.archivos.join(', ')})`).join('; '), c.codigos[0].codigo]),
    ),
  );

  out.push('## Posibles duplicados entre mapas');
  out.push('');
  out.push('Misma geometría publicada en mapas distintos. Pueden ser servicios distintos sobre el mismo camino: no se fusionan.');
  out.push('');
  out.push(
    table(
      ['Mapa A', 'Mapa B', 'Clase', 'Similitud', 'Distancia media / p95'],
      r.duplicados.map((d) => [
        `${d.rutaA} · ${d.tituloA} #${d.a.split('#')[1]}`,
        `${d.rutaB} · ${d.tituloB} #${d.b.split('#')[1]}`,
        d.clase,
        pct(d.similitud),
        `${d.distanciaMediaM} m / ${d.distanciaP95M} m`,
      ]),
    ),
  );

  out.push('## Intervenciones de Qwen');
  out.push('');
  out.push(
    table(
      ['Mapa', 'Tiempo', 'Cambios aplicados / descartados', 'Explicación', 'Validación'],
      r.ia.intervenciones.map((i) => [
        i.titulo,
        i.enCache ? 'caché' : secs(i.ms),
        i.cambios.join('; ') || (i.error ? `error: ${i.error}` : 'sin cambios'),
        i.explicacion,
        i.descartes.join('; '),
      ]),
    ),
  );

  const others = r.trazos.filter((t) => t.rol !== 'principal');
  out.push(`## Tramos, ampliaciones y bases (${others.length}, no se generan)`);
  out.push('');
  out.push(
    table(
      ['Ruta', 'Mapa', 'Trazo', 'Tipo', 'Nombre / DESCRIPCIO', 'Km', 'Relación con la principal'],
      others.map((t) => [
        t.ruta,
        t.tituloMapa,
        t.indice,
        t.rol,
        t.nombreOriginal + (t.descripcion ? ` · ${t.descripcion}` : ''),
        t.longitudKm,
        t.relacion ? `${t.relacion.tipo} (trazo ${t.relacion.principal.split('#')[1]})` : '—',
      ]),
    ),
  );

  if (r.salida) {
    out.push('## Archivos');
    out.push('');
    out.push(
      `Nuevos ${r.salida.escritos.length} · actualizados ${r.salida.actualizados.length} · sin cambios ${r.salida.sinCambios.length} · obsoletos movidos ${r.salida.obsoletos.length} · conflictos ${r.salida.conflictos.length}`,
    );
    out.push('');
    if (r.salida.conflictos.length)
      out.push(
        table(
          ['Archivo', 'Motivo'],
          r.salida.conflictos.map((c) => [c.rel, c.motivo]),
        ),
      );
  }
  if (r.errores.length) {
    out.push('## Errores y avisos');
    out.push('');
    for (const e of r.errores) out.push(`- ${e}`);
  }
  out.push('');
  out.push('## Cómo se calcula la similitud');
  out.push('');
  out.push(
    `Tolerancia ${r.configuracion.similitud ? (r.configuracion.similitud as OrqConfig['similitud']).toleranciaM : '?'} m. Cobertura A→B = % de puntos de A (muestreados cada ~25 m) a menos de la tolerancia de B; similitud = promedio de ambas coberturas. "casi idéntico": ambas coberturas ≥ ${(r.configuracion.similitud as OrqConfig['similitud'])?.casiIdentico} y longitudes parecidas; "contenido": una sola cobertura alta; "parcial": similitud ≥ ${(r.configuracion.similitud as OrqConfig['similitud'])?.parcial}. Detalle en orchestrator/README.md.`,
  );
  out.push('');
  return out.join('\n');
}
