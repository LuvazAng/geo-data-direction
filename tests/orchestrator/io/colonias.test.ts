import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildKml,
  parseKml,
  type Coord,
  ColoniaIndex,
  coloniaNombre,
  coloniasAlong,
  coloniasKml,
  type ColoniaFeature,
  type ColoniaProps,
  type ColoniasData,
} from '@core';
import { loadColoniasIne, parseTmPrj, tmInverse, toGeometry } from '../../../src/orchestrator/io/colonias';
import { COLONIAS_DIR, FIXTURES, hasColonias } from '../../helpers';

const UTM14 =
  'PROJCS["WGS_1984_UTM_Zone_14N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-99.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';

describe('proyección Transversa de Mercator (INE, UTM 14N)', () => {
  it('ejemplo numérico de Snyder (Map Projections): Clarke 1866, x=127106.5, y=4484124.4 → 40°30′N 73°30′W', () => {
    const [lon, lat] = tmInverse({ a: 6378206.4, invF: 294.9786982, lat0: 0, lon0: -75, k0: 0.9996, fe: 0, fn: 0 })([127106.5, 4484124.4]);
    expect(lat).toBeCloseTo(40.5, 5);
    expect(lon).toBeCloseTo(-73.5, 5);
  });

  it('lee el .prj del INE; el falso este cae en el meridiano central', () => {
    const p = parseTmPrj(UTM14);
    expect(p).toMatchObject({ a: 6378137, lon0: -99, k0: 0.9996, fe: 500000, fn: 0 });
    const [lon, lat] = tmInverse(p)([500000, 0]);
    expect(lon).toBeCloseTo(-99, 9);
    expect(lat).toBeCloseTo(0, 9);
  });

  it('rechaza otras proyecciones', () => {
    expect(() => parseTmPrj('PROJCS["x",PROJECTION["Lambert_Conformal_Conic"]]')).toThrow(/no soportada/);
  });
});

describe('anillos del shapefile → GeoJSON', () => {
  // en el shapefile el exterior va en sentido horario y los huecos al revés
  const outer: Coord[] = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ];
  const hole: Coord[] = [
    [0.2, 0.2],
    [0.4, 0.2],
    [0.4, 0.4],
    [0.2, 0.4],
    [0.2, 0.2],
  ];

  it('exterior con su hueco, con la orientación de RFC 7946', () => {
    expect(toGeometry([outer, hole])).toEqual({ type: 'Polygon', coordinates: [[...outer].reverse(), [...hole].reverse()] });
  });

  it('dos exteriores son un MultiPolygon; anillos degenerados se descartan', () => {
    const other = outer.map(([x, y]): Coord => [x + 5, y]);
    const g = toGeometry([
      outer,
      other,
      [
        [9, 9],
        [9, 9],
        [9, 9],
        [9, 9],
      ],
    ]);
    expect(g?.type).toBe('MultiPolygon');
    expect(g?.coordinates).toHaveLength(2);
    expect(
      toGeometry([
        [
          [0, 0],
          [0, 1],
          [0, 0],
        ],
      ]),
    ).toBeNull();
  });
});

// Cuadros de colonias a la latitud de Morelos: 0.01° de longitud ≈ 1 053 m
const LAT = 18.905;
const M_PER_DEG = 111_320 * Math.cos((LAT * Math.PI) / 180);
const box = (x0: number, x1: number): Coord[][] => [
  [
    [x0, 18.9],
    [x1, 18.9],
    [x1, 18.91],
    [x0, 18.91],
    [x0, 18.9],
  ],
];
const colonia = (id: number, nombre: string, x0: number, x1: number, tipo = 'Colonia'): ColoniaFeature => ({
  type: 'Feature',
  properties: { id, nombre, tipo, municipio: 'CUERNAVACA', cp: '62000' },
  geometry: { type: 'Polygon', coordinates: box(x0, x1) },
});
const index = new ColoniaIndex({
  type: 'FeatureCollection',
  fuente: 'prueba',
  features: [
    colonia(1, 'A', -99.2, -99.19),
    colonia(2, 'B', -99.19, -99.18, 'Barrio'),
    // hueco de -99.18 a -99.175: tramo fuera de colonias
    colonia(3, 'CENTRO', -99.175, -99.17), // una colonia partida en dos polígonos
    colonia(4, 'CENTRO', -99.17, -99.165),
    colonia(5, 'ESQUINA', -99.165, -99.164),
  ],
});
const near = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThan(15);

describe('colonias por las que pasa un trazo', () => {
  it('en orden, con metros, tramo fuera y colonias partidas juntas; lo que apenas toca no se lista', () => {
    const r = coloniasAlong(
      [
        [-99.199, LAT],
        [-99.1648, LAT],
      ],
      index,
    );
    expect(r.pasos.map((p) => p.colonia.nombre)).toEqual(['A', 'B', 'CENTRO']);
    near(r.pasos[0].metros, 0.009 * M_PER_DEG);
    near(r.pasos[1].metros, 0.01 * M_PER_DEG);
    expect(r.pasos[2].ids).toEqual([3, 4]);
    near(r.pasos[2].metros, 0.01 * M_PER_DEG);
    near(r.pasos[2].desdeM, 0.024 * M_PER_DEG);
    near(r.fueraM, 0.005 * M_PER_DEG);
    near(r.totalM, 0.0342 * M_PER_DEG);
  });

  it('una calle que es el límite entre dos colonias cuenta para las dos, una sola vez cada una', () => {
    // zigzag de ±10 m sobre el límite A|B
    const coords = Array.from({ length: 20 }, (_, i): Coord => [-99.19 + (i % 2 ? 1 : -1) * 0.0001, 18.901 + i * 0.0004]);
    const r = coloniasAlong(coords, index);
    expect(r.pasos.map((p) => p.colonia.nombre)).toEqual(['A', 'B']);
    expect(r.pasos[0].metros).toBeGreaterThan(300);
    expect(r.pasos[1].metros).toBeGreaterThan(300);
  });

  it('el sentido del trazo invierte el orden', () => {
    const r = coloniasAlong(
      [
        [-99.1648, LAT],
        [-99.199, LAT],
      ],
      index,
    );
    expect(r.pasos.map((p) => p.colonia.nombre)).toEqual(['CENTRO', 'B', 'A']);
  });

  it('texto para el KML: tipo + nombre, municipio', () => {
    const r = coloniasAlong(
      [
        [-99.199, LAT],
        [-99.1648, LAT],
      ],
      index,
    );
    expect(coloniasKml(r)).toBe('COLONIA A, CUERNAVACA; BARRIO B, CUERNAVACA; COLONIA CENTRO, CUERNAVACA');
  });

  it('no repite el tipo si el nombre ya lo trae', () => {
    const c = (tipo: string, nombre: string): ColoniaProps => ({ id: 1, nombre, tipo, municipio: 'X', cp: '' });
    expect(coloniaNombre(c('Barrio', 'SAN JUAN'))).toBe('BARRIO SAN JUAN');
    expect(coloniaNombre(c('Unidad habitacional', 'LAS PILETAS'))).toBe('UNIDAD HABITACIONAL LAS PILETAS');
    expect(coloniaNombre(c('Ampliación', 'AMPLIACIÓN CHAMILPA'))).toBe('AMPLIACIÓN CHAMILPA');
    expect(coloniaNombre(c('Colonia', 'COLONIA NIÑOS HEROES'))).toBe('COLONIA NIÑOS HEROES');
    expect(coloniaNombre(c('', 'SIN TIPO'))).toBe('SIN TIPO');
  });
});

describe('campo COLONIAS en el KML', () => {
  const doc = (placemark: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>x</name>${placemark}</Document></kml>`;
  const coords = '<LineString><coordinates>-99.2,18.9,0 -99.1,18.9,0</coordinates></LineString>';
  const withData = doc(
    `<Placemark><name>R1</name><ExtendedData><Data name="DESCRIPCIO"><value>A-B</value></Data><SchemaData schemaUrl="#s"><SimpleData name="FOLIO">7</SimpleData></SchemaData></ExtendedData>${coords}</Placemark>`,
  );
  const count = (s: string) => s.split('name="COLONIAS"').length - 1;

  it('se agrega junto a los demás datos (antes de SchemaData) y se lee de vuelta', () => {
    const out = buildKml(withData, { reversed: false, colonias: 'COLONIA A, CUERNAVACA' });
    expect(parseKml(out).props).toMatchObject({ DESCRIPCIO: 'A-B', FOLIO: '7', COLONIAS: 'COLONIA A, CUERNAVACA' });
    expect(out.indexOf('name="COLONIAS"')).toBeLessThan(out.indexOf('<SchemaData'));
  });

  it('al volver a guardar se reemplaza; vacío lo quita; sin definir se deja como está', () => {
    const first = buildKml(withData, { reversed: false, colonias: 'COLONIA A, CUERNAVACA' });
    const second = buildKml(first, { reversed: true, colonias: 'BARRIO B, CUERNAVACA' });
    expect(count(second)).toBe(1);
    expect(parseKml(second).props.COLONIAS).toBe('BARRIO B, CUERNAVACA');
    expect(parseKml(buildKml(second, { reversed: false })).props.COLONIAS).toBe('BARRIO B, CUERNAVACA');
    const cleared = buildKml(second, { reversed: false, colonias: '' });
    expect(count(cleared)).toBe(0);
    expect(parseKml(cleared).props.DESCRIPCIO).toBe('A-B');
  });

  it('si el trazo no tiene ExtendedData, se crea antes de la geometría', () => {
    const out = buildKml(doc(`<Placemark><name>R1</name>${coords}</Placemark>`), { reversed: false, colonias: 'COLONIA A & B, X' });
    expect(out.indexOf('<ExtendedData>')).toBeLessThan(out.indexOf('<LineString>'));
    expect(parseKml(out).props.COLONIAS).toBe('COLONIA A & B, X');
  });
});

describe.skipIf(!hasColonias)('colonias reales del INE (Base Geográfica Digital, opcional)', () => {
  let data: ColoniasData;
  beforeAll(() => {
    data = loadColoniasIne(COLONIAS_DIR);
  });

  it('todo Morelos: 1 932 colonias de los 36 municipios, con tipo y municipio', () => {
    expect(data.features).toHaveLength(1932);
    expect(new Set(data.features.map((f) => f.properties.municipio)).size).toBe(36);
    expect(data.features.every((f) => f.properties.municipio && f.properties.tipo)).toBe(true);
    expect(data.features.find((f) => f.properties.id === 1)?.properties).toMatchObject({
      nombre: 'OTILIO MONTAÑO',
      tipo: 'Colonia',
      municipio: 'JIUTEPEC',
      cp: '62577',
    });
  });

  it('la Ruta 2 Sur (Jojutla → Poza Honda) sale del Centro de Jojutla y llega a Poza Honda', () => {
    const route = parseKml(readFileSync(join(FIXTURES, 'etiquetados/SUR/RUTA-2-SUR/3/R2S-JOJU-PZONDA.kml'), 'utf8'));
    const r = coloniasAlong(route.coords, new ColoniaIndex(data));
    expect(coloniaNombre(r.pasos[0].colonia)).toBe('COLONIA CENTRO');
    expect(r.pasos[0].colonia.municipio).toBe('JOJUTLA');
    expect(r.pasos.some((p) => p.colonia.nombre === 'POZA HONDA')).toBe(true);
    expect(r.fueraM / r.totalM).toBeLessThan(0.1);
  });
});
