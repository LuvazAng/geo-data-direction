import { describe, expect, it } from 'vitest';
import { abbreviatePlace, buildName, compareNames, evaluateName, parseName, validSiglas, type NameContext } from '@core';

// El ejemplo de quien resuelve a mano: un nombre libre con paréntesis, puntos y un acento dañado.
const MESSY = '5.-(3.-CIRCUNVALACION (COL. PABLO TORRES BURGOS)-TIERRA LARGA Y 12 DE OCTUBRE (BASE TACAMBRO-CIRCUNVALACIàN)';

const ctx = (over: Partial<NameContext> = {}): NameContext => ({
  ruta: 'R6O',
  inicio: { lugar: 'Tierra Larga', siglas: 'TLARG' },
  final: { lugar: '12 de Octubre', siglas: '12OCT' },
  ...over,
});

describe('abbreviatePlace', () => {
  it('arma las siglas de los ejemplos: iniciales y las primeras letras de la última palabra', () => {
    expect(abbreviatePlace('Tierra Larga')).toBe('TLARG');
    expect(abbreviatePlace('12 de Octubre')).toBe('12OCT');
    expect(abbreviatePlace('Pablo Torres Burgos')).toBe('PTBUR');
    // coincide con el código que ya usan las rutas clasificadas
    expect(abbreviatePlace('San Gabriel Las Palmas')).toBe('SGPAL');
  });

  it('quita acentos y palabras sueltas (de, la, col.) y respeta el máximo', () => {
    expect(abbreviatePlace('COL. LA ESPERANZA')).toBe('ESPER');
    expect(abbreviatePlace('Circunvalación')).toBe('CIRCU');
    expect(abbreviatePlace('Santa María Ahuacatitlán del Valle', 6).length).toBeLessThanOrEqual(6);
    expect(abbreviatePlace('')).toBe('');
    expect(abbreviatePlace('DE LA')).toBe('');
  });

  it('lo que genera cumple las siglas válidas', () => {
    for (const name of ['Tierra Larga', '12 de Octubre', 'Pablo Torres Burgos', 'Hospital', 'Unidad Fovissste Otilio Montaño', '3 de Mayo']) {
      expect(validSiglas(abbreviatePlace(name)), name).toBe(true);
    }
  });
});

describe('validSiglas', () => {
  it('acepta de 2 a 6 mayúsculas o números y rechaza lo demás', () => {
    for (const ok of ['IXT', 'SGPAL', '12OCT', 'PZONDA', 'AB']) expect(validSiglas(ok), ok).toBe(true);
    for (const bad of ['A', 'ABCDEFG', 'tlarg', 'T-LAR', 'TÍAR', 'TL ARG', '']) expect(validSiglas(bad), bad).toBe(false);
  });
});

describe('parseName y buildName', () => {
  it('lee RUTA-ORIGEN-DESTINO y con sufijo de repetido', () => {
    expect(parseName('R6O-12OCT-TLARG')).toEqual({ ruta: 'R6O', origen: '12OCT', destino: 'TLARG' });
    expect(parseName('R6O-12OCT-TLARG-2')).toEqual({ ruta: 'R6O', origen: '12OCT', destino: 'TLARG', sufijo: '2' });
    expect(parseName('R2S-JOJU-PZONDAXGAS')).toMatchObject({ origen: 'JOJU', destino: 'PZONDAXGAS' });
  });

  it('un nombre libre no tiene esa forma', () => {
    expect(parseName(MESSY)).toBeNull();
    expect(parseName('R6O-SOLO')).toBeNull();
    expect(parseName('')).toBeNull();
  });

  it('arma y vuelve a leer el mismo nombre', () => {
    const name = buildName('R6O', '12OCT', 'TLARG');
    expect(name).toBe('R6O-12OCT-TLARG');
    expect(parseName(name)).toMatchObject({ ruta: 'R6O', origen: '12OCT', destino: 'TLARG' });
  });
});

describe('evaluateName', () => {
  it('el nombre ideal cumple los seis criterios', () => {
    const e = evaluateName('R6O-TLARG-12OCT', ctx());
    expect(e).toMatchObject({ cumple: 6, total: 6, puntaje: 100, ideal: true });
  });

  it('el ejemplo original no sigue el formato, pero sí menciona las dos colonias en orden', () => {
    const e = evaluateName(MESSY, ctx());
    const by = Object.fromEntries(e.criterios.map((c) => [c.id, c]));
    expect(by.formato.ok).toBe(false);
    expect(by.caracteres.ok).toBe(false);
    expect(by.caracteres.detalle).toBe('Tiene espacios, puntos, paréntesis, «à».');
    expect(by.ruta.ok).toBe(false);
    expect(by.ruta.detalle).toBe('Debe empezar con R6O.');
    expect(by.siglas.ok).toBe(false);
    expect(by.lugares.ok).toBe(true);
    expect(by.lugares.detalle).toBe('Menciona Tierra Larga y luego 12 de Octubre.');
    expect(by.unico.ok).toBe(true);
    expect(e).toMatchObject({ cumple: 2, total: 6, puntaje: 33, ideal: false });
  });

  it('un nombre libre que menciona las colonias al revés lo dice', () => {
    const e = evaluateName(MESSY, ctx({ inicio: { lugar: '12 de Octubre', siglas: '12OCT' }, final: { lugar: 'Tierra Larga', siglas: 'TLARG' } }));
    const lugares = e.criterios.find((c) => c.id === 'lugares')!;
    expect(lugares.ok).toBe(false);
    expect(lugares.detalle).toMatch(/al revés/);
  });

  it('un nombre libre que no menciona una colonia dice cuál falta', () => {
    const e = evaluateName('1.-COL. MORELOS-HOSPITAL', ctx());
    expect(e.criterios.find((c) => c.id === 'lugares')!.detalle).toBe('No menciona Tierra Larga ni 12 de Octubre.');
    const a = evaluateName('1.-TIERRA LARGA-HOSPITAL', ctx());
    expect(a.criterios.find((c) => c.id === 'lugares')!.detalle).toBe('No menciona 12 de Octubre, donde termina el trazo.');
  });

  it('un nombre con la forma correcta pero otras siglas dice qué siglas esperaba', () => {
    const e = evaluateName('R6BO-CIRC-TETE', ctx());
    const by = Object.fromEntries(e.criterios.map((c) => [c.id, c]));
    expect(by.formato.ok).toBe(true);
    expect(by.caracteres.ok).toBe(true);
    expect(by.ruta.ok).toBe(false);
    expect(by.ruta.detalle).toBe('Empieza con R6BO; la ruta es R6O.');
    expect(by.lugares.ok).toBe(false);
    expect(by.lugares.detalle).toBe('Dice CIRC-TETE; el trazo va de Tierra Larga (TLARG) a 12 de Octubre (12OCT).');
  });

  it('siglas demasiado largas no cuentan como siglas', () => {
    const e = evaluateName('R6O-TIERRALARGA-12OCT', ctx());
    expect(e.criterios.find((c) => c.id === 'siglas')!.ok).toBe(false);
  });

  it('un nombre que ya usa otro trazo no es único', () => {
    const e = evaluateName('R6O-TLARG-12OCT', ctx({ ocupados: new Set(['R6O-TLARG-12OCT']) }));
    expect(e.criterios.find((c) => c.id === 'unico')).toMatchObject({ ok: false, detalle: 'Otro trazo ya usa este nombre.' });
    expect(e.ideal).toBe(false);
    expect(e.cumple).toBe(5);
  });
});

describe('compareNames', () => {
  const eva = (name: string) => evaluateName(name, ctx());

  it('la propuesta ideal gana al original', () => {
    const r = compareNames(eva(MESSY), eva('R6O-TLARG-12OCT'));
    expect(r.mejor).toBe('propuesta');
    expect(r.texto).toBe('La propuesta se acerca más al nombre ideal (6 de 6 contra 2 de 6).');
  });

  it('si el nombre actual ya cumple más, lo dice', () => {
    const r = compareNames(eva('R6O-TLARG-12OCT'), eva('R6O-TLARG-XXXXXXX'));
    expect(r.mejor).toBe('otro');
  });

  it('empatan cuando cumplen lo mismo', () => {
    expect(compareNames(eva('R6O-TLARG-12OCT'), eva('R6O-TLARG-12OCT')).mejor).toBe('igual');
  });
});
