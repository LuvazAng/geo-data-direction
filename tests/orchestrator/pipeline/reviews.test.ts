import { existsSync, readFileSync, rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseKmlAll, ColoniaIndex, type ColoniaFeature } from '@core';
import type { Report } from '../../../src/orchestrator/pipeline/report';
import type { ReviewResolution, TraceRow } from '@protocol';
import {
  buildResolvedKml,
  decideMap,
  duplaFolders,
  evaluateMap,
  renumberDuplas,
  resolveReview,
  resolveReviews,
  reviewSnapshot,
  undoMapReviews,
} from '../../../src/orchestrator/pipeline/reviews';
import { Workspace, sha256, type BatchState } from '../../../src/orchestrator/io/store';
import { tmp } from '../../helpers';
import { testLote } from '../server/helpers';

const KML = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Mapa</name>
<Placemark><name>Principal</name><LineString><coordinates>-99,18 -98.99,18</coordinates></LineString></Placemark>
<Placemark><name>Extension</name><LineString><coordinates>-98.99,18 -98.98,18</coordinates></LineString></Placemark>
</Document></kml>`;

function row(id: string, indice: number, estado: TraceRow['estado']): TraceRow {
  return {
    id,
    ruta: 'ruta-1-sur',
    mapa: 'mapa01xxxxxxxx',
    mapaAsignado: 'mapa01xxxxxxxx',
    tituloMapa: 'Mapa de prueba',
    orden: 1,
    indice,
    nombreOriginal: indice === 0 ? 'Principal' : 'Extension',
    descripcion: indice === 0 ? 'A-B' : 'B-C',
    autoAmpl: '',
    oid: '',
    rol: 'principal',
    longitudKm: 1,
    origen: indice === 0 ? 'A' : 'B',
    destino: indice === 0 ? 'B' : 'C',
    via: null,
    variante: '',
    fuenteNombres: 'DESCRIPCIO',
    inicio: { coord: [-99, 18], localidad: 'A', distanciaM: 0, municipio: 'Municipio' },
    final: { coord: [-98.98, 18], localidad: 'C', distanciaM: 0, municipio: 'Municipio' },
    sentido: indice === 0 ? 'confirmado' : 'sin-evidencia',
    puntaje: 0,
    evidencias: [{ fuente: 'ia', peso: 0, detalle: 'Qwen: circuito extendido' }],
    dupla: indice === 0 ? 1 : 2,
    duplaN: indice === 0 ? 1 : 2,
    similitudDupla: null,
    nombreFinal: indice === 0 ? 'R1-A-B' : null,
    nombrePropuesto: 'R1-A-C',
    codigos: null,
    metodo: 'prueba',
    estado,
    motivosRevision: estado === 'REQUIERE_REVISION' ? ['sin evidencia de sentido'] : [],
    duplicadoDe: null,
    relacion: null,
    anomalias: [],
    archivo: indice === 0 ? 'SUR/RUTA-1-SUR/1/R1-A-B.kml' : '_REVISION/RUTA-1-SUR/1-1 A-C.kml',
  };
}

function setup() {
  const work = tmp('revision-');
  const lote = testLote(work, 'REVISION', ['ruta-1-sur']);
  const ws = new Workspace(work, 'REVISION');
  const mapId = 'mapa01xxxxxxxx';
  const candidate = row('candidate', 1, 'REQUIERE_REVISION');
  const principal = row('principal', 0, 'GENERADO');
  principal.archivo = 'SUR/RUTA-1-SUR/1/R1-A-B.kml';
  const report = {
    lote: 'REVISION',
    zona: 'SUR',
    fuente: 'https://example.test',
    inicio: '',
    fin: '',
    duracionMs: 0,
    tiempos: {},
    configuracion: { similitud: { toleranciaM: 50, casiIdentico: 0.9 } },
    resumen: {
      paginas: 1,
      paginasConError: 0,
      mapasEncontrados: 1,
      descargadosEnEstaCorrida: 1,
      yaDescargados: 0,
      mapasConError: 0,
      mapasGenerados: 0,
      mapasEnRevision: 1,
      trazos: 2,
      itinerariosPrincipales: 2,
      generados: 1,
      requierenRevision: 1,
      tramosCortos: 0,
      ampliaciones: 0,
      bases: 0,
      sinIdentificar: 0,
      duplicadosDentroDelMapa: 0,
      reasignados: 0,
      posiblesDuplicadosEntreMapas: 0,
      paresComparados: 0,
    },
    paginas: [
      { slug: 'ruta-1-sur', titulo: 'Ruta 1', mapas: 1, estado: 'ok', codigoRuta: { codigo: 'R1', carpeta: 'RUTA-1-SUR', origen: 'config' }, terminal: null },
    ],
    mapas: [{ id: mapId, ruta: 'ruta-1-sur', orden: 1, titulo: 'Mapa de prueba', url: 'https://example.test/map', estado: 'REQUIERE_REVISION', trazos: 2 }],
    trazos: [principal, candidate],
    duplicados: [],
    etiquetados: { total: 0, emparejados: 0, coincideSentido: 0, coincideNombre: 0, detalle: [] },
    ia: { habilitada: false, disponible: false, detalle: 'sin IA', consultas: 0, enCache: 0, aplicadas: 0, errores: 0, intervenciones: [] },
    codigos: { rutas: [{ slug: 'ruta-1-sur', codigo: 'R1', carpeta: 'RUTA-1-SUR', origen: 'config' }], sugeridos: [], viasSugeridas: [], conflictos: [] },
    salida: null,
    errores: [],
  } as Report;
  const state: BatchState = {
    version: 1,
    lote: 'REVISION',
    fuente: '',
    creadoEn: '',
    actualizadoEn: '',
    mapas: {
      [mapId]: {
        id: mapId,
        title: 'Mapa de prueba',
        pageSlug: 'ruta-1-sur',
        downloadUrl: 'https://example.test/map',
        estado: 'REQUIERE_REVISION',
        intentos: 1,
        archivo: 'm.kml',
        actualizadoEn: '',
      },
    },
  };
  ws.write(['originales', 'm.kml'], KML);
  ws.write(['resultados', '_REVISION', 'RUTA-1-SUR', '1-1 A-C.kml'], '<kml>revision</kml>');
  ws.writeJson(['estado.json'], state);
  ws.writeJson(['reporte.json'], report);
  ws.writeJson(['resultados', 'manifiesto.json'], {
    version: 1,
    archivos: {
      '_REVISION/RUTA-1-SUR/1-1 A-C.kml': {
        sha256: sha256('<kml>revision</kml>'),
        tipo: 'revision',
        traza: 'candidate',
        mapa: mapId,
        fuente: 'https://example.test/map',
        original: 'originales/m.kml',
        generadoEn: '',
      },
    },
  });
  return { lote, ws };
}

describe('resolución manual de revisión', () => {
  it('muestra relación geométrica con vértices y genera una ampliación reversible', () => {
    const { lote, ws } = setup();
    const snapshot = reviewSnapshot(lote);
    expect(snapshot.pendientes).toHaveLength(1);
    expect(snapshot.pendientes[0].archivoOriginal).toBe('originales/m.kml');
    expect(snapshot.pendientes[0].totalTrazosMapa).toBe(2);
    expect(snapshot.pendientes[0].nombresMapa).toEqual([
      { indice: 0, nombre: 'R1-A-B' },
      { indice: 1, nombre: 'R1-A-C' },
    ]);
    expect(snapshot.pendientes[0].preview?.relacionadas[0]).toMatchObject({
      traza: 'principal',
      relacion: { tipo: 'ext-final', sePuedeUnir: true, verticeSalida: 2 },
    });

    const result = resolveReview(lote, {
      traza: 'candidate',
      accion: 'generar',
      tipo: 'ampliacion',
      nombre: 'R1-A-C',
      relacionPrincipal: 'principal',
      origen: 'A',
      destino: 'C',
      nota: 'Extiende la ruta principal',
    });
    expect(result.traza.estado).toBe('GENERADO');
    expect(result.traza).toMatchObject({ origen: 'A', destino: 'C', sentido: 'confirmado', relacion: { principal: 'principal', tipo: 'ext-final' } });
    expect(result.archivo).toBe('resultados/SUR/RUTA-1-SUR/1/R1-A-C.kml');
    const generated = parseKmlAll(ws.read('resultados', 'SUR', 'RUTA-1-SUR', '1', 'R1-A-C.kml').toString());
    expect(generated).toHaveLength(1);
    expect(generated[0].coords).toEqual([
      [-99, 18],
      [-98.99, 18],
      [-98.98, 18],
    ]);
    expect(generated[0].name).toBe('R1-A-C');
    expect(reviewSnapshot(lote).pendientes).toHaveLength(0);
    expect(reviewSnapshot(lote).resueltas[0].resolucion?.tipo).toBe('ampliacion');
    expect(ws.readJson<Report | null>(['reporte.json'], null)!.resumen).toMatchObject({ generados: 2, requierenRevision: 0 });

    resolveReview(lote, { traza: 'candidate', accion: 'deshacer' });
    expect(existsSync(ws.path('resultados', 'SUR', 'RUTA-1-SUR', '1', 'R1-A-C.kml'))).toBe(false);
    expect(existsSync(ws.path('resultados', '_REVISION', 'RUTA-1-SUR', '1-1 A-C.kml'))).toBe(true);
    expect(reviewSnapshot(lote).pendientes).toHaveLength(1);
  });

  it('descarta sin borrar el archivo y permite restaurarlo', () => {
    const { lote, ws } = setup();
    resolveReview(lote, { traza: 'candidate', accion: 'descartar' });
    expect(existsSync(ws.path('resultados', '_REVISION', 'RUTA-1-SUR', '1-1 A-C.kml'))).toBe(false);
    expect(reviewSnapshot(lote).resueltas[0].resolucion?.estado).toBe('descartado');
    resolveReview(lote, { traza: 'candidate', accion: 'deshacer' });
    expect(readFileSync(ws.path('resultados', '_REVISION', 'RUTA-1-SUR', '1-1 A-C.kml'), 'utf8')).toBe('<kml>revision</kml>');
  });

  it('requiere origen, destino y sentido al confirmar un recorrido propio', () => {
    const { lote } = setup();
    expect(() => resolveReview(lote, { traza: 'candidate', accion: 'generar', tipo: 'propia', nombre: 'R1-A-C' })).toThrow(/origen, destino y sentido/);
  });

  it('genera una ruta propia en el sentido confirmado manualmente', () => {
    const { lote, ws } = setup();
    const result = resolveReview(lote, {
      traza: 'candidate',
      accion: 'generar',
      tipo: 'propia',
      nombre: 'R1-C-B',
      origen: 'C',
      destino: 'B',
      sentido: 'inverso',
    });
    expect(result.traza).toMatchObject({ origen: 'C', destino: 'B', sentido: 'contrario' });
    const kml = parseKmlAll(ws.read('resultados', 'SUR', 'RUTA-1-SUR', '1', 'R1-C-B.kml').toString());
    expect(kml[0].coords).toEqual([
      [-98.98, 18],
      [-98.99, 18],
    ]);
  });

  it('la ruta propia lleva las colonias por las que pasa, en el sentido confirmado', () => {
    const cuadro = (id: number, nombre: string, x0: number, x1: number): ColoniaFeature => ({
      type: 'Feature',
      properties: { id, nombre, tipo: 'Colonia', municipio: 'X', cp: '' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [x0, 17.99],
            [x1, 17.99],
            [x1, 18.01],
            [x0, 18.01],
            [x0, 17.99],
          ],
        ],
      },
    });
    const colonias = new ColoniaIndex({
      type: 'FeatureCollection',
      fuente: 'prueba',
      features: [cuadro(1, 'P', -98.99, -98.985), cuadro(2, 'Q', -98.985, -98.98)],
    });
    const decision = { estado: 'generado', tipo: 'propia', nombre: 'R1-C-B', origen: 'C', destino: 'B', sentido: 'inverso' } as ReviewResolution;
    const kml = buildResolvedKml(row('candidate', 1, 'REQUIERE_REVISION'), decision, KML, undefined, undefined, colonias);
    expect(parseKmlAll(kml)[0].props.COLONIAS).toBe('COLONIA Q, X; COLONIA P, X');
  });

  it('avisa si las colonias instaladas no se pueden leer', () => {
    const { lote } = setup();
    lote.config.dirs.colonias = tmp('colonias-rotas-'); // existe, pero sin COLONIA ni MUNICIPIO
    expect(() =>
      resolveReview(lote, { traza: 'candidate', accion: 'generar', tipo: 'propia', nombre: 'R1-C-B', origen: 'C', destino: 'B', sentido: 'inverso' }),
    ).toThrow(/No se encontró .*MUNICIPIO/);
  });

  it('sin colonias instaladas genera igual, sin el campo COLONIAS', () => {
    const { lote, ws } = setup();
    lote.config.dirs.colonias = 'no-existe-colonias';
    resolveReview(lote, { traza: 'candidate', accion: 'generar', tipo: 'propia', nombre: 'R1-C-B', origen: 'C', destino: 'B', sentido: 'inverso' });
    expect(parseKmlAll(ws.read('resultados', 'SUR', 'RUTA-1-SUR', '1', 'R1-C-B.kml').toString())[0].props.COLONIAS).toBeUndefined();
  });

  it('usa la carpeta de la ruta conectada aunque el reporte antiguo tenga otra duplaN', () => {
    const { lote, ws } = setup();
    const result = resolveReview(lote, {
      traza: 'candidate',
      accion: 'generar',
      tipo: 'propia',
      nombre: 'R1-B-C',
      origen: 'B',
      destino: 'C',
      sentido: 'directo',
    });

    expect(result.archivo).toBe('resultados/SUR/RUTA-1-SUR/1/R1-B-C.kml');
    expect(existsSync(ws.path('resultados', 'SUR', 'RUTA-1-SUR', '2', 'R1-B-C.kml'))).toBe(false);
  });

  it('registra como generado el KML editado en el mapa sin reconstruir su geometría', () => {
    const { lote, ws } = setup();
    const edited = KML.replace('-98.98,18', '-98.97,18');
    const result = resolveReview(lote, {
      traza: 'candidate',
      accion: 'generar',
      tipo: 'propia',
      nombre: 'R1-A-C-editada',
      contenidoKml: edited,
      nota: 'Geometría editada en el mapa',
    });

    expect(result.traza.estado).toBe('GENERADO');
    expect(result.resolucion?.geometriaEditada).toBe(true);
    const generated = parseKmlAll(ws.read('resultados', 'SUR', 'RUTA-1-SUR', '1', 'R1-A-C-editada.kml').toString());
    expect(generated).toHaveLength(2);
    expect(generated[1].coords).toContainEqual([-98.97, 18]);
  });

  it('resuelve todos los conflictos del mapa en KML individuales', () => {
    const { lote, ws } = setup();
    const report = ws.readJson<Report>(['reporte.json'], null as never);
    report.trazos[0].estado = 'REQUIERE_REVISION';
    report.trazos[0].motivosRevision = ['sentido sin confirmar'];
    ws.writeJson(['reporte.json'], report);

    const manifest = ws.readJson<{
      version: 1;
      archivos: Record<
        string,
        { sha256: string; tipo: 'resultado' | 'revision'; traza: string; mapa: string; fuente: string; original: string; generadoEn: string }
      >;
    }>(['resultados', 'manifiesto.json'], null as never);
    const firstRevision = '_REVISION/RUTA-1-SUR/1-0 A-B.kml';
    ws.write(['resultados', ...firstRevision.split('/')], '<kml>revision principal</kml>');
    manifest.archivos[firstRevision] = {
      sha256: sha256('<kml>revision principal</kml>'),
      tipo: 'revision',
      traza: 'principal',
      mapa: 'mapa01xxxxxxxx',
      fuente: 'https://example.test/map',
      original: 'originales/m.kml',
      generadoEn: '',
    };
    ws.writeJson(['resultados', 'manifiesto.json'], manifest);

    const individual = (name: string, coords: string) =>
      `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>${name}</name><LineString><coordinates>${coords}</coordinates></LineString></Placemark></Document></kml>`;
    const resolved = resolveReviews(lote, [
      { traza: 'principal', accion: 'generar', tipo: 'propia', nombre: 'R1O-TBUR-YECA', contenidoKml: individual('R1O-TBUR-YECA', '-99,18 -98.99,18') },
      { traza: 'candidate', accion: 'generar', tipo: 'propia', nombre: 'R1O-YECA-TBUR', contenidoKml: individual('R1O-YECA-TBUR', '-98.99,18 -99,18') },
    ]);

    expect(resolved).toHaveLength(2);
    expect(resolved.every((item) => item.traza.estado === 'GENERADO')).toBe(true);
    const first = parseKmlAll(ws.read('resultados', 'SUR', 'RUTA-1-SUR', '1', 'R1O-TBUR-YECA.kml').toString());
    const second = parseKmlAll(ws.read('resultados', 'SUR', 'RUTA-1-SUR', '1', 'R1O-YECA-TBUR.kml').toString());
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(reviewSnapshot(lote).pendientes).toHaveLength(0);
  });

  it('descarta en el mismo lote los trazos eliminados en el editor', () => {
    const { lote, ws } = setup();
    const report = ws.readJson<Report>(['reporte.json'], null as never);
    report.trazos[0].estado = 'REQUIERE_REVISION';
    ws.writeJson(['reporte.json'], report);
    const manifest = ws.readJson<{ version: 1; archivos: Record<string, unknown> }>(['resultados', 'manifiesto.json'], null as never);
    const firstRevision = '_REVISION/RUTA-1-SUR/1-0 A-B.kml';
    ws.write(['resultados', ...firstRevision.split('/')], '<kml>revision principal</kml>');
    manifest.archivos[firstRevision] = {
      sha256: sha256('<kml>revision principal</kml>'),
      tipo: 'revision',
      traza: 'principal',
      mapa: 'mapa01xxxxxxxx',
      fuente: 'https://example.test/map',
      original: 'originales/m.kml',
      generadoEn: '',
    };
    ws.writeJson(['resultados', 'manifiesto.json'], manifest);

    const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>R1O-TBUR-YECA</name><LineString><coordinates>-99,18 -98.99,18</coordinates></LineString></Placemark></Document></kml>`;
    const resolved = resolveReviews(lote, [
      { traza: 'principal', accion: 'generar', tipo: 'propia', nombre: 'R1O-TBUR-YECA', contenidoKml: kml },
      { traza: 'candidate', accion: 'descartar', nota: 'Eliminado en el editor' },
    ]);

    expect(resolved.map((item) => item.traza.estado)).toEqual(['GENERADO', 'NO_SE_GENERA']);
    expect(existsSync(ws.path('resultados', 'SUR', 'RUTA-1-SUR', '1', 'R1O-TBUR-YECA.kml'))).toBe(true);
    expect(existsSync(ws.path('resultados', '_REVISION', 'RUTA-1-SUR', '1-1 A-C.kml'))).toBe(false);
    expect(reviewSnapshot(lote).pendientes).toHaveLength(0);
    expect(() => resolveReviews(lote, [{ traza: 'candidate', accion: 'descartar' }])).toThrow();

    // deshacer la resolución completa del mapa devuelve ambos trazos a revisión
    const undone = undoMapReviews(lote, 'mapa01xxxxxxxx');
    expect(undone.map((item) => item.traza.estado)).toEqual(['REQUIERE_REVISION', 'REQUIERE_REVISION']);
    expect(existsSync(ws.path('resultados', 'SUR', 'RUTA-1-SUR', '1', 'R1O-TBUR-YECA.kml'))).toBe(false);
    expect(existsSync(ws.path('resultados', '_REVISION', 'RUTA-1-SUR', '1-0 A-B.kml'))).toBe(true);
    expect(existsSync(ws.path('resultados', '_REVISION', 'RUTA-1-SUR', '1-1 A-C.kml'))).toBe(true);
    const snapshot = reviewSnapshot(lote);
    expect(snapshot.pendientes).toHaveLength(2);
    expect(snapshot.resueltas).toHaveLength(0);
    expect(() => undoMapReviews(lote, 'mapa01xxxxxxxx')).toThrow('no tiene resoluciones');
  });
});

describe('carpetas de dupla sin huecos', () => {
  const single = (name: string) =>
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>${name}</name><LineString><coordinates>-98.98,18 -98.97,18</coordinates></LineString></Placemark></Document></kml>`;

  /** Agrega un segundo mapa (orden 2, dupla 3 del pipeline) con un trazo pendiente C→D. */
  function withSecondMap() {
    const { lote, ws } = setup();
    const report = ws.readJson<Report>(['reporte.json'], null as never);
    const third = row('third', 0, 'REQUIERE_REVISION');
    Object.assign(third, {
      mapa: 'mapa02xxxxxxxx',
      mapaAsignado: 'mapa02xxxxxxxx',
      orden: 2,
      dupla: 3,
      duplaN: 3,
      origen: 'C',
      destino: 'D',
      archivo: '_REVISION/RUTA-1-SUR/2-0 C-D.kml',
    });
    report.trazos.push(third);
    ws.writeJson(['reporte.json'], report);
    const state = ws.readJson<BatchState>(['estado.json'], null as never);
    state.mapas.mapa02xxxxxxxx = { ...state.mapas.mapa01xxxxxxxx, id: 'mapa02xxxxxxxx', archivo: 'm2.kml' };
    ws.writeJson(['estado.json'], state);
    ws.write(['originales', 'm2.kml'], single('C-D'));
    ws.write(['resultados', '_REVISION', 'RUTA-1-SUR', '2-0 C-D.kml'], '<kml>revision C-D</kml>');
    const manifest = ws.readJson<{ version: 1; archivos: Record<string, unknown> }>(['resultados', 'manifiesto.json'], null as never);
    manifest.archivos['_REVISION/RUTA-1-SUR/2-0 C-D.kml'] = {
      sha256: sha256('<kml>revision C-D</kml>'),
      tipo: 'revision',
      traza: 'third',
      mapa: 'mapa02xxxxxxxx',
      fuente: 'https://example.test/map2',
      original: 'originales/m2.kml',
      generadoEn: '',
    };
    ws.writeJson(['resultados', 'manifiesto.json'], manifest);
    return { lote, ws };
  }

  it('numera las duplas vivas en orden, juntando las que se resolvieron juntas', () => {
    const rows = [
      row('a', 0, 'GENERADO'),
      row('b', 1, 'GENERADO'),
      row('c', 0, 'REQUIERE_REVISION'),
      row('d', 1, 'NO_SE_GENERA'),
      row('e', 0, 'REQUIERE_REVISION'),
    ];
    rows.forEach((r, i) => (r.dupla = r.duplaN = i + 1));
    // b (dupla 2) se resolvió junto con la dupla 1 y d (dupla 4) se descartó
    rows[1].resolucionManual = { estado: 'generado', nota: '', resueltoEn: '', dupla: 1 };
    expect([...duplaFolders(rows, 'ruta-1-sur')]).toEqual([
      [1, 1],
      [2, 1],
      [3, 2],
      [5, 3],
    ]);
  });

  it('una dupla descartada no deja su número vacío y deshacer recorre las carpetas', () => {
    const { lote, ws } = withSecondMap();
    resolveReview(lote, { traza: 'candidate', accion: 'descartar' });
    const result = resolveReview(lote, { traza: 'third', accion: 'generar', tipo: 'propia', nombre: 'R1-C-D', contenidoKml: single('R1-C-D') });
    expect(result.archivo).toBe('resultados/SUR/RUTA-1-SUR/2/R1-C-D.kml');

    // al volver a pendiente la dupla 2, el mapa 2 pasa a la carpeta 3
    resolveReview(lote, { traza: 'candidate', accion: 'deshacer' });
    expect(existsSync(ws.path('resultados', 'SUR', 'RUTA-1-SUR', '3', 'R1-C-D.kml'))).toBe(true);
    expect(existsSync(ws.path('resultados', 'SUR', 'RUTA-1-SUR', '2'))).toBe(false);
    expect(ws.readJson<Report>(['reporte.json'], null as never).trazos.find((t) => t.id === 'third')?.archivo).toBe('SUR/RUTA-1-SUR/3/R1-C-D.kml');
    expect(Object.keys(ws.readJson<{ archivos: Record<string, unknown> }>(['resultados', 'manifiesto.json'], null as never).archivos)).toContain(
      'SUR/RUTA-1-SUR/3/R1-C-D.kml',
    );

    // y su resolución se sigue pudiendo deshacer desde la carpeta nueva
    resolveReview(lote, { traza: 'third', accion: 'deshacer' });
    expect(existsSync(ws.path('resultados', 'SUR', 'RUTA-1-SUR', '3', 'R1-C-D.kml'))).toBe(false);
    expect(existsSync(ws.path('resultados', '_REVISION', 'RUTA-1-SUR', '2-0 C-D.kml'))).toBe(true);
  });

  it('corrige las resoluciones antiguas que quedaron en la carpeta con el número de su dupla', () => {
    const { lote, ws } = withSecondMap();
    resolveReview(lote, { traza: 'candidate', accion: 'descartar' });
    resolveReview(lote, { traza: 'third', accion: 'generar', tipo: 'propia', nombre: 'R1-C-D', contenidoKml: single('R1-C-D') });
    // como lo dejaba la versión anterior: en la carpeta 3 y sin registrar la dupla
    const [from, to] = ['SUR/RUTA-1-SUR/2/R1-C-D.kml', 'SUR/RUTA-1-SUR/3/R1-C-D.kml'];
    ws.write(['resultados', ...to.split('/')], ws.read('resultados', ...from.split('/')));
    rmSync(ws.path('resultados', 'SUR', 'RUTA-1-SUR', '2'), { recursive: true });
    const report = ws.readJson<Report>(['reporte.json'], null as never);
    const third = report.trazos.find((t) => t.id === 'third')!;
    third.archivo = to;
    delete third.resolucionManual!.dupla;
    ws.writeJson(['reporte.json'], report);
    const reviews = ws.readJson<{ decisiones: Record<string, { archivoDestino: string; dupla?: number }> }>(['revisiones.json'], null as never);
    reviews.decisiones.third.archivoDestino = to;
    delete reviews.decisiones.third.dupla;
    ws.writeJson(['revisiones.json'], reviews);
    const manifest = ws.readJson<{ archivos: Record<string, unknown> }>(['resultados', 'manifiesto.json'], null as never);
    manifest.archivos[to] = manifest.archivos[from];
    delete manifest.archivos[from];
    ws.writeJson(['resultados', 'manifiesto.json'], manifest);

    expect(renumberDuplas(lote)).toEqual([{ de: to, a: from }]);
    expect(existsSync(ws.path('resultados', ...from.split('/')))).toBe(true);
    expect(existsSync(ws.path('resultados', 'SUR', 'RUTA-1-SUR', '3'))).toBe(false);
    expect(ws.readJson<typeof reviews>(['revisiones.json'], null as never).decisiones.third).toMatchObject({ archivoDestino: from, dupla: 3 });
    expect(renumberDuplas(lote)).toEqual([]);
  });
});

describe('mapas sin itinerarios utilizables', () => {
  const single = (name: string) =>
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>${name}</name><LineString><coordinates>-98.98,18 -98.97,18</coordinates></LineString></Placemark></Document></kml>`;
  const SIN = 'mapa00xxxxxxxx';
  const CON = 'mapa01xxxxxxxx';

  /**
   * Mapa 1 sin itinerarios (4 trazos tomados como base y 1 ampliación) y mapa 2 con su dupla ya
   * generada en la carpeta 1.
   */
  function setupWithoutItineraries() {
    const { lote, ws } = setup();
    const report = ws.readJson<Report>(['reporte.json'], null as never);
    const generated = report.trazos.find((t) => t.id === 'principal')!;
    Object.assign(generated, { orden: 2 });
    const others = ['b0', 'b1', 'b2', 'b3', 'amp'].map((id, i) =>
      Object.assign(row(id, i, 'NO_SE_GENERA'), {
        mapa: SIN,
        mapaAsignado: SIN,
        orden: 1,
        tituloMapa: '1.-BASE FRESNAL A BASE COL. CUAUHTEMOC',
        rol: id === 'amp' ? 'ampliacion' : 'base',
        dupla: null,
        duplaN: undefined,
        origen: null,
        destino: null,
        nombreFinal: null,
        nombrePropuesto: null,
        archivo: null,
        motivosRevision: [],
      }),
    );
    // el pendiente del mapa 2 no estorba: se descarta antes
    report.trazos = [...others, generated, report.trazos.find((t) => t.id === 'candidate')!];
    report.trazos.find((t) => t.id === 'candidate')!.orden = 2;
    report.mapas.unshift({
      id: SIN,
      ruta: 'ruta-1-sur',
      orden: 1,
      titulo: '1.-BASE FRESNAL A BASE COL. CUAUHTEMOC',
      url: 'https://example.test/map0',
      estado: 'REQUIERE_REVISION',
      trazos: 5,
    });
    report.mapas[1].orden = 2;
    ws.writeJson(['reporte.json'], report);
    const state = ws.readJson<BatchState>(['estado.json'], null as never);
    state.mapas[SIN] = {
      ...state.mapas[CON],
      id: SIN,
      downloadUrl: 'https://example.test/map0',
      archivo: 'm0.kml',
      estado: 'REQUIERE_REVISION',
      error: 'sin itinerarios utilizables',
    };
    ws.writeJson(['estado.json'], state);
    ws.write(['originales', 'm0.kml'], KML);
    ws.write(['resultados', 'SUR', 'RUTA-1-SUR', '1', 'R1-A-B.kml'], '<kml>generado</kml>');
    const manifest = ws.readJson<{ version: 1; archivos: Record<string, unknown> }>(['resultados', 'manifiesto.json'], null as never);
    manifest.archivos['SUR/RUTA-1-SUR/1/R1-A-B.kml'] = {
      sha256: sha256('<kml>generado</kml>'),
      tipo: 'resultado',
      traza: 'principal',
      mapa: CON,
      fuente: 'https://example.test/map',
      original: 'originales/m.kml',
      generadoEn: '',
    };
    ws.writeJson(['resultados', 'manifiesto.json'], manifest);
    resolveReview(lote, { traza: 'candidate', accion: 'descartar' });
    return { lote, ws };
  }

  it('el centro lo ofrece para evaluar a mano o descartar, con el motivo', () => {
    const { lote } = setupWithoutItineraries();
    const snapshot = reviewSnapshot(lote);
    expect(snapshot.sinItinerarios).toEqual([
      {
        mapa: SIN,
        motivo: 'sin itinerarios utilizables: 1 ampliación(es), 4 trazo(s) de base',
        archivoOriginal: 'originales/m0.kml',
        trazos: ['b0', 'b1', 'b2', 'b3', 'amp'].map((traza, indice) => ({ traza, indice })),
      },
    ]);
    // un mapa con itinerarios no se evalúa a mano ni se descarta completo
    expect(() => decideMap(lote, CON, 'descartar')).toThrow(/sin itinerarios/);
  });

  it('registra dos duplas en carpetas consecutivas y recorre las del mapa siguiente; deshacer lo devuelve', () => {
    const { lote, ws } = setupWithoutItineraries();
    const items = evaluateMap(lote, {
      mapa: SIN,
      generar: [
        { traza: 'b0', nombre: 'R6O-BFRE-BCUA', contenidoKml: single('R6O-BFRE-BCUA'), dupla: 1 },
        { traza: 'b1', nombre: 'R6O-BCUA-BFRE', contenidoKml: single('R6O-BCUA-BFRE'), dupla: 1 },
        { traza: 'b2', nombre: 'R6O-BFRE-WAL', contenidoKml: single('R6O-BFRE-WAL'), dupla: 2 },
        { traza: 'b3', nombre: 'R6O-WAL-BFRE', contenidoKml: single('R6O-WAL-BFRE'), dupla: 2 },
      ],
      descartar: [{ traza: 'amp' }],
    });

    expect(items.map((item) => [item.traza.id, item.traza.estado, item.archivo])).toEqual([
      ['b0', 'GENERADO', 'resultados/SUR/RUTA-1-SUR/1/R6O-BFRE-BCUA.kml'],
      ['b1', 'GENERADO', 'resultados/SUR/RUTA-1-SUR/1/R6O-BCUA-BFRE.kml'],
      ['b2', 'GENERADO', 'resultados/SUR/RUTA-1-SUR/2/R6O-BFRE-WAL.kml'],
      ['b3', 'GENERADO', 'resultados/SUR/RUTA-1-SUR/2/R6O-WAL-BFRE.kml'],
      ['amp', 'NO_SE_GENERA', null],
    ]);
    expect(parseKmlAll(ws.read('resultados', 'SUR', 'RUTA-1-SUR', '2', 'R6O-WAL-BFRE.kml').toString())[0].name).toBe('R6O-WAL-BFRE');
    // la dupla del mapa 2 pasa a la carpeta 3
    expect(existsSync(ws.path('resultados', 'SUR', 'RUTA-1-SUR', '3', 'R1-A-B.kml'))).toBe(true);
    expect(ws.readJson<Report>(['reporte.json'], null as never).trazos.find((t) => t.id === 'principal')?.archivo).toBe('SUR/RUTA-1-SUR/3/R1-A-B.kml');
    expect(ws.readJson<BatchState>(['estado.json'], null as never).mapas[SIN]).toMatchObject({ estado: 'GENERADO' });
    expect(reviewSnapshot(lote).sinItinerarios).toEqual([]);
    expect(() => decideMap(lote, SIN, 'descartar')).toThrow(/sin resoluciones/);

    undoMapReviews(lote, SIN);
    expect(existsSync(ws.path('resultados', 'SUR', 'RUTA-1-SUR', '1', 'R1-A-B.kml'))).toBe(true);
    expect(existsSync(ws.path('resultados', 'SUR', 'RUTA-1-SUR', '2'))).toBe(false);
    expect(existsSync(ws.path('resultados', 'SUR', 'RUTA-1-SUR', '3'))).toBe(false);
    expect(ws.readJson<BatchState>(['estado.json'], null as never).mapas[SIN]).toMatchObject({
      estado: 'REQUIERE_REVISION',
      error: 'sin itinerarios utilizables: 1 ampliación(es), 4 trazo(s) de base',
    });
    expect(reviewSnapshot(lote).sinItinerarios).toHaveLength(1);
  });

  it('un mapa sin nada se descarta completo (deja de esperar revisión) y se puede deshacer', () => {
    const { lote, ws } = setupWithoutItineraries();
    decideMap(lote, SIN, 'descartar', 'sólo ampliaciones');
    expect(ws.readJson<BatchState>(['estado.json'], null as never).mapas[SIN].estado).toBe('DESCARTADO');
    expect(ws.readJson<Report>(['reporte.json'], null as never).resumen).toMatchObject({ mapasDescartados: 1 });
    const snapshot = reviewSnapshot(lote);
    expect(snapshot.sinItinerarios).toEqual([]);
    expect(snapshot.mapasDescartados).toMatchObject([{ mapa: SIN, estado: 'descartado', nota: 'sólo ampliaciones' }]);
    expect(() => evaluateMap(lote, { mapa: SIN, generar: [{ traza: 'b0', nombre: 'X', contenidoKml: single('X'), dupla: 1 }], descartar: [] })).toThrow(
      /sin resoluciones/,
    );

    decideMap(lote, SIN, 'deshacer');
    expect(ws.readJson<BatchState>(['estado.json'], null as never).mapas[SIN].estado).toBe('REQUIERE_REVISION');
    expect(reviewSnapshot(lote).sinItinerarios).toHaveLength(1);
    expect(() => decideMap(lote, SIN, 'deshacer')).toThrow(/no está descartado/);
  });
});
