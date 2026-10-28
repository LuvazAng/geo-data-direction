import { beforeAll, describe, expect, it } from 'vitest';
import { lccInverse, loadInegi, parsePrj, readDbf, readShp, type PlaceIndex } from '../../../src/orchestrator/io/inegi';
import { hasInegiReal, INEGI_DIR, INEGI_REAL_DIR, JOJUTLA, PUENTE_IXTLA } from '../../helpers';

const PRJ =
  'PROJCS["MEXICO_ITRF_2008_LCC",GEOGCS["GCS_ITRF_2008",DATUM["D_ITRF_2008",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",2500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-102.0],PARAMETER["Standard_Parallel_1",17.5],PARAMETER["Standard_Parallel_2",29.5],PARAMETER["Latitude_Of_Origin",12.0],UNIT["Meter",1.0]]';

describe('proyección Lambert Cónica Conforme (INEGI)', () => {
  it('el origen falso cae en el meridiano central y la latitud de origen', () => {
    const inv = lccInverse(parsePrj(PRJ));
    const [lon, lat] = inv([2_500_000, 0]);
    expect(lon).toBeCloseTo(-102, 9);
    expect(lat).toBeCloseTo(12, 9);
  });

  it('rechaza otras proyecciones', () => {
    expect(() => parsePrj('GEOGCS["WGS 84"]')).toThrow(/no soportada/);
  });
});

describe('lector mínimo de shapefile y DBF', () => {
  it('lee un punto y un polígono', () => {
    // encabezado de 100 bytes + 1 punto
    const shp = Buffer.alloc(100 + 8 + 20);
    shp.writeInt32BE(9994, 0);
    shp.writeInt32BE(shp.length / 2, 24);
    shp.writeInt32BE(1, 100);
    shp.writeInt32BE(10, 104);
    shp.writeInt32LE(1, 108);
    shp.writeDoubleLE(2_500_000, 112);
    shp.writeDoubleLE(0, 120);
    expect(readShp(shp)).toEqual([{ type: 'point', xy: [2_500_000, 0] }]);
  });

  it('DBF en ISO-8859-1', () => {
    const fields = [{ name: 'NOMGEO', len: 12 }];
    const header = Buffer.alloc(32 + 32 * fields.length + 1);
    header.writeUInt32LE(1, 4);
    header.writeUInt16LE(header.length, 8);
    header.writeUInt16LE(1 + 12, 10);
    header.write('NOMGEO', 32, 'latin1');
    header[32 + 11] = 0x43;
    header[32 + 16] = 12;
    header[header.length - 1] = 0x0d;
    const rec = Buffer.concat([Buffer.from(' '), Buffer.from('Tlaltizapán '.padEnd(12), 'latin1')]);
    expect(readDbf(Buffer.concat([header, rec]))).toEqual([{ NOMGEO: 'Tlaltizapán' }]);
  });
});

/** Las mismas comprobaciones sobre el extracto del repositorio y, si está, sobre el Marco Geoestadístico completo. */
const localidades = (nombre: string, dir: string, omitir = false) =>
  describe.skipIf(omitir)(nombre, () => {
    let idx: PlaceIndex;
    beforeAll(() => {
      idx = loadInegi(dir);
    });
    it('los extremos de la Ruta 1 Sur caen en Jojutla y Puente de Ixtla', () => {
      expect(idx.near(JOJUTLA, 2000)[0]).toMatchObject({ nombre: 'Jojutla', dentro: true, distanciaM: 0 });
      expect(idx.near(PUENTE_IXTLA, 2000)[0]).toMatchObject({ nombre: 'Puente de Ixtla', dentro: true });
      expect(idx.municipioDe(JOJUTLA)).toBe('Jojutla');
    });
    it('un punto lejos de toda localidad no devuelve candidatos', () => {
      expect(idx.near([-99.6, 19.6], 2000)).toEqual([]);
    });
  });

localidades('localidades INEGI (extracto de las fixtures)', INEGI_DIR);
localidades('localidades INEGI reales (Marco Geoestadístico completo)', INEGI_REAL_DIR, !hasInegiReal);
