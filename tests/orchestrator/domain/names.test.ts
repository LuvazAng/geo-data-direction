import { describe, expect, it } from 'vitest';
import { LearnedCodes, parseRouteName } from '../../../src/orchestrator/domain/labeled';
import { CodeBook, fillPattern, folderOf, routeCodeFor, suggestCode } from '../../../src/orchestrator/domain/naming';
import { abbreviates, samePlace, viaKey } from '../../../src/orchestrator/domain/places';
import { fixMojibake, parsePlaces } from '../../../src/orchestrator/domain/traces';
import { testConfig, tmp } from '../../helpers';

describe('nombres de lugares', () => {
  it.each([
    ['JOJUTLA', 'Jojutla de Juárez', true],
    ['JOJUTLA', 'Campo Jojutla', false],
    ['SANTA ROSA 30', 'Santa Rosa Treinta', true],
    ['TILZPOTLA', 'TILZAPOTLA', true],
    ['ALTAVISTA', 'ALTA VISTA POR ARRIBA', true],
    ['SAN', 'SANTA FE', false],
    ['POZA HONDA', 'Colonia Poza Honda', true],
    ['COL. LA CRUZ', 'LA CRUZ', true],
    ['PUENTE DE IXTLA', 'JOJUTLA', false],
  ])('%s ~ %s → %s', (a, b, expected) => {
    expect(samePlace(a, b)).toBe(expected);
  });

  it('las variantes de "por dónde pasa" se agrupan', () => {
    expect(viaKey('LA GAS')).toBe(viaKey('LAS GAS'));
    expect(viaKey('LA FARMACIA')).toBe(viaKey('FARMACIA'));
    expect(viaKey('LA GAS')).not.toBe(viaKey('LA FARMACIA'));
  });

  it('código como abreviatura del nombre', () => {
    expect(abbreviates('IXT', 'PUENTE DE IXTLA')).toBe(true);
    expect(abbreviates('PZONDA', 'POZA HONDA')).toBe(true);
    expect(abbreviates('JOJU', 'PUENTE DE IXTLA')).toBe(false);
  });
});

describe('texto con codificación rota', () => {
  it('repara CP850 leído como Windows-1252', () => {
    expect(fixMojibake('Av. L zaro C rdenas, M‚xico')).toBe('Av. Lázaro Cárdenas, México');
    expect(fixMojibake('AMPLIACIàN LAZARO')).toBe('AMPLIACIÓN LAZARO');
  });
  it('no toca texto correcto', () => {
    expect(fixMojibake('U.H. JOSé MARíA MORELOS')).toBe('U.H. JOSé MARíA MORELOS');
    expect(fixMojibake('Puente de Ixtla')).toBe('Puente de Ixtla');
  });
});

describe('títulos y DESCRIPCIO', () => {
  it.each([
    ['1.-PUENTE DE IXTLA-JOJUTLA', ['PUENTE DE IXTLA', 'JOJUTLA'], null, false],
    ['5. PUENTE DE IXTLA-TEACALCO-PUENTE DE IXTLA', ['PUENTE DE IXTLA', 'TEACALCO', 'PUENTE DE IXTLA'], null, true],
    ['JOJUTLA-POZA HONDA (X LA FARMACIA)', ['JOJUTLA', 'POZA HONDA'], 'LA FARMACIA', false],
    ['COL. BENITO JUAREZ-JOJUTLA ( X LAS GAS)', ['COL. BENITO JUAREZ', 'JOJUTLA'], 'LAS GAS', false],
    ['JOJUTLA (X LA GAS)-SAN MIGUEL 30', ['JOJUTLA', 'SAN MIGUEL 30'], 'LA GAS', false],
    ['SAN MIGUEL-JOJUTLA X FARMACIA', ['SAN MIGUEL', 'JOJUTLA'], 'FARMACIA', false],
    ['3. JOJUTLA-PUENTE DE IXTLA X AV. TECNOLOGICO', ['JOJUTLA', 'PUENTE DE IXTLA'], 'AV. TECNOLOGICO', false],
    ['13. JOJUTLA-3 DE MAYO-JOJUTLA', ['JOJUTLA', '3 DE MAYO', 'JOJUTLA'], null, true],
  ])('%s', (title, places, via, circuit) => {
    expect(parsePlaces(title)).toEqual({ places, via, circuit });
  });
});

describe('código de ruta (regla de la letra de zona)', () => {
  const cfg = testConfig(tmp());
  const zone = [
    'ruta-1-sur',
    'ruta-1-ahuehuetzingo-sur',
    'ruta-4-grupo-independiente-sur',
    'ruta-4-atlacholoaya-sur',
    'ruta-5a-sur',
    'ruta-30-sur',
    'c-t-m-sur',
    'interescolar-sur',
  ];
  const other = { numbers: new Set(['1', '4', '5']), codes: new Set(['CTM', 'INT_ESC']) };

  it('el número que ya existe en otra zona lleva la letra de la zona', () => {
    expect(routeCodeFor('ruta-1-sur', zone, cfg, other)).toMatchObject({ codigo: 'R1S', carpeta: 'RUTA-1-SUR', origen: 'regla' });
    expect(routeCodeFor('ruta-4-grupo-independiente-sur', zone, cfg, other).codigo).toBe('R4S');
    expect(routeCodeFor('ruta-5a-sur', zone, cfg, other).codigo).toBe('R5AS');
    expect(routeCodeFor('ruta-30-sur', zone, cfg, other).codigo).toBe('R30');
  });

  it('en ORIENTE la letra es O', () => {
    const ori = testConfig(tmp(), { zona: 'ORIENTE' });
    expect(routeCodeFor('ruta-4-oriente', ['ruta-4-oriente'], ori, other).codigo).toBe('R4O');
  });

  it('dos subpáginas con el mismo número: la segunda lleva letras sugeridas', () => {
    const r = routeCodeFor('ruta-1-ahuehuetzingo-sur', zone, cfg, other);
    expect(r).toMatchObject({ codigo: 'R1AHS', origen: 'sugerido' });
    expect(routeCodeFor('ruta-4-atlacholoaya-sur', zone, cfg, other).codigo).toBe('R4ATS');
  });

  it('la configuración manda sobre la regla', () => {
    const c = testConfig(tmp(), { nomenclatura: { rutas: { 'ruta-1-ahuehuetzingo-sur': { codigo: 'R1AH' } } } as never });
    expect(routeCodeFor('ruta-1-ahuehuetzingo-sur', zone, c, other)).toMatchObject({ codigo: 'R1AH', origen: 'config' });
  });

  it('grupos sin número: rutasBase y letra si el código existe en otra zona', () => {
    const c = testConfig(tmp(), { nomenclatura: { rutasBase: { 'C T M': 'CTM', INTERESCOLAR: 'INT_ESC' } } as never });
    expect(routeCodeFor('c-t-m-sur', zone, c, other).codigo).toBe('CTMS');
    expect(routeCodeFor('interescolar-sur', zone, c, other).codigo).toBe('INT_ESCS');
  });

  it('carpeta sin acentos', () => {
    expect(folderOf('autobuses-circunvalación-jojutla')).toBe('AUTOBUSES-CIRCUNVALACION-JOJUTLA');
  });
});

describe('códigos de localidad y nombres repetidos (caso 12)', () => {
  it('configuración > aprendido > sugerido; los sugeridos son únicos', () => {
    const book = new CodeBook({ 'Puente de Ixtla': 'IXT' }, { JOJUTLA: 'JOJU', TEMIMILCINGO: 'TEMI' }, 'sugerir', {});
    expect(book.codeFor('PUENTE DE IXTLA')).toEqual({ codigo: 'IXT', origen: 'config' });
    expect(book.codeFor('Jojutla')).toEqual({ codigo: 'JOJU', origen: 'aprendido' });
    expect(book.codeFor('TEMIXCO')).toEqual({ codigo: 'TEMI2', origen: 'sugerido' }); // TEMI ya es de Temimilcingo
    expect(book.codeFor('TEMIXCO').codigo).toBe('TEMI2'); // estable
    expect(book.codeFor('OTILIO MONTAÑOS')).toEqual({ codigo: 'OMON', origen: 'sugerido' });
  });

  it('una letra de diferencia usa el mismo código', () => {
    const book = new CodeBook({}, { 'OTILIO MONTANO': 'OTI', CHACAMPALCO: 'CHAC' }, 'sugerir', {});
    expect(book.codeFor('OTILIO MONTAÑOS').codigo).toBe('OTI');
    expect(book.codeFor('CHCAMPALCO').codigo).toBe('CHAC');
  });

  it('en modo revisión no inventa códigos', () => {
    expect(new CodeBook({}, {}, 'revision', {}).codeFor('LA TIGRA')).toEqual({ codigo: null, origen: null });
  });

  it('códigos sugeridos con la misma forma que los existentes', () => {
    expect(suggestCode('SAN GABRIEL LAS PALMAS')).toBe('SGPAL');
    expect(suggestCode('MICHAPA')).toBe('MICH');
    expect(suggestCode('SANTA ROSA 30')).toBe('SR30');
  });

  it('el patrón produce nombres válidos y rechaza los que no lo son', () => {
    expect(fillPattern('{ruta}-{origen}-{destino}{via}', { ruta: 'R2S', origen: 'JOJU', destino: 'PZONDA', via: 'GAS' })).toBe('R2S-JOJU-PZONDAXGAS');
    expect(() => fillPattern('{ruta}-{origen}-{destino}', { ruta: 'R2S', origen: 'JO JU', destino: 'X' })).toThrow(/inválido/);
  });

  it('catálogo aprendido por mayoría, con conflictos visibles', () => {
    const l = new LearnedCodes();
    for (const [c, f] of [
      ['IXT', 'a'],
      ['IXT', 'b'],
      ['ITXT', 'c'],
    ])
      l.add('PUENTE DE IXTLA', c, f, {});
    expect(l.winners()).toEqual({ 'PUENTE IXTLA': 'IXT' });
    expect(l.conflicts()[0].codigos.map((v) => v.codigo)).toEqual(['IXT', 'ITXT']);
  });

  it('lee los nombres existentes, con la vía pegada al destino', () => {
    expect(parseRouteName('R1S-JOJU-IXT.kml')).toEqual({ ruta: 'R1S', origen: 'JOJU', destino: 'IXT', via: null });
    expect(parseRouteName('R4-BA-CHXPU', new Set(['CH', 'BA']))).toEqual({ ruta: 'R4', origen: 'BA', destino: 'CH', via: 'PU' });
    expect(parseRouteName('R2-5FRC-BU-XEZ')).toEqual({ ruta: 'R2', origen: '5FRC', destino: 'BU', via: 'EZ' });
  });
});
