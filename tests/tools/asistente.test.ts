import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  accionesPara,
  actualizarEnv,
  asistente,
  comandoOllama,
  ejecutar,
  esSi,
  leerEstado,
  modeloInstalado,
  motivoNoPregunta,
  OLLAMA_LINUX,
  preguntasPara,
  type Accion,
  type Entorno,
  type EntradaEjecutar,
  type Opciones,
} from '../../tools/asistente.mjs';
import { tmp } from '../helpers';

const vacio: Entorno = {
  plataforma: 'win32',
  modeloNombre: 'qwen3.5:4b',
  ollama: false,
  modelo: false,
  winget: true,
  brew: false,
  coloniasGeojson: false,
  datosConfigurados: false,
  datosActual: '',
};
const entorno = (o: Partial<Entorno> = {}): Entorno => ({ ...vacio, ...o });
const aire: Opciones = { interactivo: true, sinAsistente: false, configurar: false };

describe('asistente de primer arranque: qué se pregunta', () => {
  it('sólo se pregunta con terminal interactiva, la primera vez o con --configurar', () => {
    expect(motivoNoPregunta({ ...aire, estado: null })).toBeNull();
    expect(motivoNoPregunta({ ...aire, estado: { version: 1 } })).toBe('ya-configurado');
    expect(motivoNoPregunta({ ...aire, configurar: true, estado: { version: 1 } })).toBeNull();
    expect(motivoNoPregunta({ ...aire, interactivo: false, estado: null })).toBe('sin-terminal');
    expect(motivoNoPregunta({ ...aire, interactivo: false, configurar: true, estado: null })).toBe('sin-terminal');
    expect(motivoNoPregunta({ ...aire, sinAsistente: true, estado: null })).toBe('sin-asistente');
  });

  it('pregunta lo que falta: IA, colonias y carpeta de datos', () => {
    expect(preguntasPara(entorno())).toEqual(['ia', 'colonias', 'datos']);
  });

  it('no pregunta por lo que ya está', () => {
    expect(preguntasPara(entorno({ ollama: true, modelo: true }))).toEqual(['colonias', 'datos']);
    expect(preguntasPara(entorno({ ollama: true, modelo: false }))).toContain('ia'); // falta el modelo
    expect(preguntasPara(entorno({ coloniasGeojson: true }))).toEqual(['ia', 'datos']);
    expect(preguntasPara(entorno({ datosConfigurados: true }))).toEqual(['ia', 'colonias']);
    expect(preguntasPara(entorno({ ollama: true, modelo: true, coloniasGeojson: true, datosConfigurados: true }))).toEqual([]);
  });

  it('con --configurar la carpeta de datos se puede cambiar aunque ya esté definida', () => {
    const todo = entorno({ ollama: true, modelo: true, coloniasGeojson: true, datosConfigurados: true });
    expect(preguntasPara(todo, { configurar: true })).toEqual(['datos']);
  });
});

describe('asistente de primer arranque: qué se ejecuta', () => {
  const si = { ia: true, colonias: false, datos: null };

  it('Windows usa winget; macOS, brew; Linux sólo muestra el comando oficial', () => {
    expect(comandoOllama(entorno()).comando).toEqual(['winget', expect.arrayContaining(['install', '--id', 'Ollama.Ollama'])]);
    expect(comandoOllama(entorno({ plataforma: 'darwin', brew: true, winget: false })).comando).toEqual(['brew', ['install', 'ollama']]);
    const linux = comandoOllama(entorno({ plataforma: 'linux', winget: false }));
    expect(linux).toEqual({ comando: null, texto: OLLAMA_LINUX });
  });

  it('sin gestor de paquetes no se ejecuta nada: se indica dónde descargarlo', () => {
    for (const e of [entorno({ winget: false }), entorno({ plataforma: 'darwin', winget: false, brew: false })]) {
      const c = comandoOllama(e);
      expect(c.comando).toBeNull();
      expect(c.texto).toContain('ollama.com/download');
    }
  });

  it('respondiendo que no a todo no se hace nada', () => {
    expect(accionesPara({ ia: false, colonias: false, datos: null }, entorno())).toEqual([]);
  });

  it('IA sin Ollama: lo instala y descarga el modelo, en ese orden', () => {
    const a = accionesPara(si, entorno());
    expect(a.map((x) => x.tipo)).toEqual(['instalar-ollama', 'descargar-modelo']);
    expect(a[1]).toEqual({ tipo: 'descargar-modelo', modelo: 'qwen3.5:4b' });
  });

  it('IA con Ollama ya instalado: sólo descarga el modelo', () => {
    expect(accionesPara(si, entorno({ ollama: true })).map((x) => x.tipo)).toEqual(['descargar-modelo']);
  });

  it('en Linux no ejecuta nada por su cuenta ni intenta descargar un modelo sin Ollama', () => {
    expect(accionesPara(si, entorno({ plataforma: 'linux', winget: false })).map((x) => x.tipo)).toEqual(['mostrar-instalacion-ollama']);
  });

  it('colonias y carpeta de datos; la carpeta se guarda primero', () => {
    const a = accionesPara({ ia: true, colonias: true, datos: 'D:/datos' }, entorno({ ollama: true, modelo: true }));
    expect(a.map((x) => x.tipo)).toEqual(['guardar-datos', 'colonias']); // el modelo ya estaba: nada que descargar
    expect(a[0]).toEqual({ tipo: 'guardar-datos', ruta: 'D:/datos' });
  });
});

describe('asistente de primer arranque: archivos locales', () => {
  it('esSi acepta s, sí, y, yes', () => {
    for (const t of ['s', 'S', 'si', 'Sí', ' y ', 'YES']) expect(esSi(t)).toBe(true);
    for (const t of ['', 'n', 'no', 'quizá']) expect(esSi(t)).toBe(false);
  });

  it('actualizarEnv crea el archivo, reemplaza la línea y respeta el resto', () => {
    const file = join(tmp(), '.env');
    actualizarEnv(file, 'GEODATA_DIR', 'C:\\mis datos\\geo');
    expect(readFileSync(file, 'utf8')).toBe('GEODATA_DIR="C:/mis datos/geo"\n');
    writeFileSync(file, '# nota\nCENTRO_PORT=5300\nGEODATA_DIR=/viejo\nOLLAMA_URL=http://127.0.0.1:1\n');
    actualizarEnv(file, 'GEODATA_DIR', '/nuevo');
    expect(readFileSync(file, 'utf8')).toBe('# nota\nCENTRO_PORT=5300\nGEODATA_DIR="/nuevo"\nOLLAMA_URL=http://127.0.0.1:1\n');
    actualizarEnv(file, 'OTRA', 'x');
    expect(readFileSync(file, 'utf8').endsWith('OLLAMA_URL=http://127.0.0.1:1\nOTRA="x"\n')).toBe(true);
  });

  it('actualizarEnv rechaza comillas y saltos de línea', () => {
    expect(() => actualizarEnv(join(tmp(), '.env'), 'GEODATA_DIR', 'a"b')).toThrow();
    expect(() => actualizarEnv(join(tmp(), '.env'), 'GEODATA_DIR', 'a\nb')).toThrow();
  });

  it('modeloInstalado mira el manifiesto de Ollama en disco', () => {
    const casa = tmp();
    const env = { OLLAMA_MODELS: join(casa, 'modelos') };
    expect(modeloInstalado('qwen3.5:4b', env)).toBe(false);
    mkdirSync(join(casa, 'modelos', 'manifests', 'registry.ollama.ai', 'library', 'qwen3.5'), { recursive: true });
    writeFileSync(join(casa, 'modelos', 'manifests', 'registry.ollama.ai', 'library', 'qwen3.5', '4b'), '{}');
    expect(modeloInstalado('qwen3.5:4b', env)).toBe(true);
    expect(modeloInstalado('qwen3.5:8b', env)).toBe(false);
  });
});

function entradas(root: string, sobre: Partial<EntradaEjecutar> = {}) {
  const llamadas: string[] = [];
  const io: EntradaEjecutar = {
    env: {},
    envArchivo: join(root, '.env'),
    log: () => {},
    run: async (cmd, args) => (llamadas.push([cmd, ...args].join(' ')), 0),
    ollama: () => 'ollama',
    ollamaListo: async () => true,
    colonias: async () => (llamadas.push('colonias'), 0),
    ...sobre,
  };
  return { io, llamadas };
}

describe('asistente de primer arranque: ejecución', () => {
  it('instala, descarga el modelo, prepara las colonias y guarda la carpeta', async () => {
    const root = tmp();
    const { io, llamadas } = entradas(root);
    const acciones: Accion[] = [
      { tipo: 'guardar-datos', ruta: '/mis/datos' },
      { tipo: 'instalar-ollama', comando: ['winget', ['install']], texto: 'winget install' },
      { tipo: 'descargar-modelo', modelo: 'qwen3.5:4b' },
      { tipo: 'colonias' },
    ];
    expect(await ejecutar(acciones, io)).toEqual(['guardar-datos', 'instalar-ollama', 'descargar-modelo', 'colonias']);
    expect(llamadas).toEqual(['winget install', 'ollama pull qwen3.5:4b', 'colonias']);
    expect(io.env.GEODATA_DIR).toBe('/mis/datos');
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('GEODATA_DIR="/mis/datos"\n');
  });

  it('si la instalación de Ollama falla, no intenta descargar el modelo', async () => {
    const { io, llamadas } = entradas(tmp(), { run: async (cmd) => (cmd === 'winget' ? 1 : 0) });
    const hecho = await ejecutar(
      [{ tipo: 'instalar-ollama', comando: ['winget', ['install']], texto: 'x' }, { tipo: 'descargar-modelo', modelo: 'm' }, { tipo: 'colonias' }],
      io,
    );
    expect(hecho).toEqual([]);
    expect(llamadas).toEqual([]);
  });

  it('si Ollama no responde, no descarga el modelo pero sigue con lo demás', async () => {
    const { io, llamadas } = entradas(tmp(), { ollamaListo: async () => false });
    expect(await ejecutar([{ tipo: 'descargar-modelo', modelo: 'm' }, { tipo: 'colonias' }], io)).toEqual(['colonias']);
    expect(llamadas).toEqual(['colonias']);
  });
});

describe('asistente de primer arranque: recorrido completo', () => {
  const respuestas = (...r: string[]) => {
    const preguntas: string[] = [];
    return { ask: async (p: string) => (preguntas.push(p), r.shift() ?? ''), preguntas };
  };

  it('sin terminal no pregunta, no instala y no recuerda nada', async () => {
    const root = tmp();
    const { io, llamadas } = entradas(root);
    const { ask, preguntas } = respuestas('s', 's', '/x');
    const motivo = await asistente({
      opciones: { ...aire, interactivo: false },
      entorno: entorno(),
      estadoArchivo: join(root, 'asistente.json'),
      ask,
      log: () => {},
      io,
    });
    expect(motivo).toBe('sin-terminal');
    expect(preguntas).toEqual([]);
    expect(llamadas).toEqual([]);
    expect(existsSync(join(root, 'asistente.json'))).toBe(false);
  });

  it('con --sin-asistente no pregunta aunque haya terminal', async () => {
    const root = tmp();
    const { io } = entradas(root);
    const { ask, preguntas } = respuestas();
    expect(
      await asistente({ opciones: { ...aire, sinAsistente: true }, entorno: entorno(), estadoArchivo: join(root, 'a.json'), ask, log: () => {}, io }),
    ).toBe('sin-asistente');
    expect(preguntas).toEqual([]);
  });

  it('«no» a todo: nada se instala, se recuerda y no vuelve a preguntar', async () => {
    const root = tmp();
    const { io, llamadas } = entradas(root);
    const estadoArchivo = join(root, 'asistente.json');
    const { ask, preguntas } = respuestas('n', 'n', '');
    expect(await asistente({ opciones: aire, entorno: entorno(), estadoArchivo, ask, log: () => {}, io })).toBeNull();
    expect(preguntas).toHaveLength(3);
    expect(llamadas).toEqual([]);
    expect(existsSync(join(root, '.env'))).toBe(false);
    expect(leerEstado(estadoArchivo)).toMatchObject({ version: 1, respuestas: { ia: false, colonias: false, datos: null }, hecho: [] });
    const otra = respuestas();
    expect(await asistente({ opciones: aire, entorno: entorno(), estadoArchivo, ask: otra.ask, log: () => {}, io })).toBe('ya-configurado');
    expect(otra.preguntas).toEqual([]);
  });

  it('«sí» sólo a las colonias: se preparan y nada más', async () => {
    const root = tmp();
    const { io, llamadas } = entradas(root);
    const { ask } = respuestas('n', 's', '');
    await asistente({ opciones: aire, entorno: entorno(), estadoArchivo: join(root, 'a.json'), ask, log: () => {}, io });
    expect(llamadas).toEqual(['colonias']);
  });

  it('con una carpeta de datos la guarda en .env', async () => {
    const root = tmp();
    const { io } = entradas(root);
    const { ask } = respuestas('n', 'n', 'D:\\geo');
    await asistente({ opciones: aire, entorno: entorno(), estadoArchivo: join(root, 'a.json'), ask, log: () => {}, io });
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('GEODATA_DIR="D:/geo"\n');
  });

  it('si ya hay de todo no pregunta nada, pero lo recuerda', async () => {
    const root = tmp();
    const { io } = entradas(root);
    const { ask, preguntas } = respuestas();
    const todo = entorno({ ollama: true, modelo: true, coloniasGeojson: true, datosConfigurados: true });
    expect(await asistente({ opciones: aire, entorno: todo, estadoArchivo: join(root, 'a.json'), ask, log: () => {}, io })).toBeNull();
    expect(preguntas).toEqual([]);
    expect(leerEstado(join(root, 'a.json'))).toMatchObject({ preguntas: [] });
  });
});
