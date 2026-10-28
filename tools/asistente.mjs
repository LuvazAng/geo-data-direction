// Asistente de primer arranque de `npm start`: pregunta qué instalar (IA local, colonias del INE, carpeta
// de datos) y lo hace sólo con tu confirmación. Corre la primera vez o con `--configurar`, y sólo si hay
// una terminal interactiva. JavaScript sin dependencias a propósito: funciona incluso antes de `npm install`.
//
// Las decisiones (qué se pregunta, qué se ejecuta) son funciones puras; lo que toca el equipo (preguntar,
// correr comandos) llega por parámetros, así se prueban sin instalar nada.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const OLLAMA_DESCARGA = 'https://ollama.com/download';
export const OLLAMA_LINUX = 'curl -fsSL https://ollama.com/install.sh | sh';

// ------------------------------------------------------------------ qué hace falta

/** Por qué no se pregunta en este arranque (null = sí se pregunta). */
export function motivoNoPregunta({ interactivo, sinAsistente, configurar, estado }) {
  if (sinAsistente) return 'sin-asistente';
  if (!interactivo) return 'sin-terminal';
  if (!configurar && estado) return 'ya-configurado';
  return null;
}

/** Preguntas que hacen falta según lo que ya hay en el equipo. */
export function preguntasPara(entorno, { configurar = false } = {}) {
  const ids = [];
  if (!(entorno.ollama && entorno.modelo)) ids.push('ia');
  if (!entorno.coloniasGeojson) ids.push('colonias');
  if (configurar || !entorno.datosConfigurados) ids.push('datos');
  return ids;
}

/** Cómo se instala Ollama aquí: un comando que se puede ejecutar, o sólo un texto para que lo haga la persona. */
export function comandoOllama(entorno) {
  if (entorno.plataforma === 'win32' && entorno.winget) {
    const comando = ['winget', ['install', '--id', 'Ollama.Ollama', '-e', '--accept-package-agreements', '--accept-source-agreements']];
    return { comando, texto: 'winget install --id Ollama.Ollama -e' };
  }
  if (entorno.plataforma === 'darwin' && entorno.brew) return { comando: ['brew', ['install', 'ollama']], texto: 'brew install ollama' };
  if (entorno.plataforma === 'linux') return { comando: null, texto: OLLAMA_LINUX };
  return { comando: null, texto: `descárgalo de ${OLLAMA_DESCARGA}` };
}

/** Lo que se hará según las respuestas, en orden. En Linux (y sin gestor de paquetes) sólo se muestra el comando. */
export function accionesPara(respuestas, entorno) {
  const acciones = [];
  if (respuestas.datos) acciones.push({ tipo: 'guardar-datos', ruta: respuestas.datos });
  if (respuestas.ia) {
    let instalable = entorno.ollama;
    if (!entorno.ollama) {
      const { comando, texto } = comandoOllama(entorno);
      acciones.push(comando ? { tipo: 'instalar-ollama', comando, texto } : { tipo: 'mostrar-instalacion-ollama', texto });
      instalable = !!comando;
    }
    if (!entorno.modelo && instalable) acciones.push({ tipo: 'descargar-modelo', modelo: entorno.modeloNombre });
  }
  if (respuestas.colonias) acciones.push({ tipo: 'colonias' });
  return acciones;
}

// ------------------------------------------------------------------ preguntas

export const esSi = (texto) => /^(s|si|sí|y|yes)$/i.test(String(texto).trim());

const TEXTOS = {
  ia: (e) => [
    'IA local (opcional)',
    '  El orquestador puede usar un modelo local (Qwen, con Ollama) para resolver casos dudosos y conversar',
    '  en el centro de control. El editor de trayectos no la necesita; sin ella todo funciona con reglas.',
    e.ollama
      ? `  Ya tienes Ollama. Falta descargar el modelo ${e.modeloNombre} (unos 3.3 GB).`
      : `  Ocupa espacio: Ollama y el modelo ${e.modeloNombre} (unos 3.3 GB).`,
    e.ollama ? `¿Descargar ${e.modeloNombre}?` : `¿Instalar Ollama y descargar ${e.modeloNombre}?`,
  ],
  colonias: () => [
    'Colonias del INE (opcional)',
    '  Muestra en el mapa las colonias por las que pasa cada trayecto y las agrega al KML.',
    '  Se descargan del INE (16 MB) y se convierten; sin ellas el editor funciona y lo avisa.',
    '¿Descargarlas ahora?',
  ],
  datos: (e) => [
    'Carpeta de datos (opcional)',
    '  Sólo para el orquestador: el Marco Geoestadístico del INEGI y, si las tienes, las rutas ya clasificadas.',
    e.datosActual
      ? `  Ahora: ${e.datosActual}. Escribe otra ruta o Enter para dejarla.`
      : '  Si ya tienes esa carpeta escribe su ruta; con Enter se usa ./data (ver data/README.md).',
  ],
};

/** Hace las preguntas de `ids` por medio de `ask(texto, pista)` y devuelve las respuestas. */
export async function preguntar(ids, entorno, { ask, log }) {
  const r = { ia: false, colonias: false, datos: null };
  for (const id of ids) {
    const [titulo, ...cuerpo] = TEXTOS[id](entorno).filter(Boolean);
    log('');
    log(`${ids.indexOf(id) + 1}/${ids.length} ${titulo}`);
    if (id === 'datos') {
      for (const l of cuerpo) log(l);
      const ruta = String(await ask(`Ruta de la carpeta [Enter = ${entorno.datosActual ? 'dejarla como está' : './data'}]: `)).trim();
      r.datos = ruta || null;
    } else {
      for (const l of cuerpo.slice(0, -1)) log(l);
      r[id] = esSi(await ask(`${cuerpo[cuerpo.length - 1]} [s/N]: `));
    }
  }
  return r;
}

// ------------------------------------------------------------------ archivos locales

export function leerEstado(archivo) {
  try {
    return JSON.parse(readFileSync(archivo, 'utf8'));
  } catch {
    return null;
  }
}

export function guardarEstado(archivo, estado) {
  mkdirSync(dirname(archivo), { recursive: true });
  writeFileSync(archivo, `${JSON.stringify(estado, null, 2)}\n`);
}

/** Pone `CLAVE="valor"` en un archivo .env (reemplaza la línea si ya estaba; crea el archivo si no existe). */
export function actualizarEnv(archivo, clave, valor) {
  if (/["\r\n]/.test(valor)) throw new Error('La ruta no puede tener comillas ni saltos de línea');
  const linea = `${clave}="${valor.replace(/\\/g, '/')}"`;
  const lineas = existsSync(archivo) ? readFileSync(archivo, 'utf8').split(/\r?\n/) : [];
  if (lineas.at(-1) === '') lineas.pop();
  const i = lineas.findIndex((l) => new RegExp(`^\\s*${clave}\\s*=`).test(l));
  if (i >= 0) lineas[i] = linea;
  else lineas.push(linea);
  writeFileSync(archivo, `${lineas.join('\n')}\n`);
}

// ------------------------------------------------------------------ el equipo

const donde = (plataforma) => (plataforma === 'win32' ? 'where.exe' : 'which');

/** Ruta de un programa en el PATH, o null. */
export function buscarComando(nombre, plataforma = process.platform) {
  const r = spawnSync(donde(plataforma), [nombre], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null;
}

export function buscarOllama(env = process.env, plataforma = process.platform) {
  const local = env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe');
  if (local && existsSync(local)) return local;
  return buscarComando('ollama', plataforma);
}

/** ¿Está el modelo descargado? Se mira el manifiesto en disco: no hace falta que Ollama esté corriendo. */
export function modeloInstalado(modelo, env = process.env, casa = homedir()) {
  const [nombre, etiqueta = 'latest'] = modelo.split(':');
  const base = env.OLLAMA_MODELS || join(casa, '.ollama', 'models');
  return existsSync(join(base, 'manifests', 'registry.ollama.ai', 'library', nombre, etiqueta));
}

/** Lo que ya hay en el equipo (para decidir qué preguntar). */
export function detectarEntorno({ root, env = process.env, plataforma = process.platform, modelo }) {
  return {
    plataforma,
    modeloNombre: modelo,
    ollama: !!buscarOllama(env, plataforma),
    modelo: modeloInstalado(modelo, env),
    winget: plataforma === 'win32' && !!buscarComando('winget', plataforma),
    brew: plataforma === 'darwin' && !!buscarComando('brew', plataforma),
    coloniasGeojson: existsSync(join(root, 'public', 'datos', 'colonias-morelos.geojson')),
    datosConfigurados: !!env.GEODATA_DIR,
    datosActual: env.GEODATA_DIR ?? '',
  };
}

// ------------------------------------------------------------------ ejecutar

/**
 * Hace lo decidido. `io` trae lo que toca el equipo: `run(comando, argumentos)` → código de salida,
 * `ollamaListo()` → Ollama respondiendo (lo inicia si hace falta), `env` y `envArchivo`, `log`.
 */
export async function ejecutar(acciones, io) {
  const hecho = [];
  for (const a of acciones) {
    if (a.tipo === 'guardar-datos') {
      actualizarEnv(io.envArchivo, 'GEODATA_DIR', a.ruta);
      io.env.GEODATA_DIR = a.ruta;
      io.log(`Carpeta de datos: ${a.ruta} (guardada en .env).${existsSync(a.ruta) ? '' : ' Todavía no existe: créala y pon ahí los datos.'}`);
      hecho.push(a.tipo);
    } else if (a.tipo === 'instalar-ollama') {
      io.log(`Instalando Ollama: ${a.texto}`);
      const codigo = await io.run(...a.comando);
      io.log(
        codigo === 0
          ? 'Ollama instalado.'
          : `La instalación terminó con código ${codigo}: instálalo tú (${OLLAMA_DESCARGA}); el centro funciona sin IA mientras tanto.`,
      );
      if (codigo !== 0) return hecho; // sin Ollama no hay modelo que descargar
      hecho.push(a.tipo);
    } else if (a.tipo === 'mostrar-instalacion-ollama') {
      io.log(`Ollama no se instala desde aquí en este sistema. Instálalo con: ${a.texto}`);
      io.log(`Después ejecuta de nuevo: npm start -- --configurar (el centro funciona sin IA mientras tanto).`);
      hecho.push(a.tipo);
    } else if (a.tipo === 'descargar-modelo') {
      if (!(await io.ollamaListo())) {
        io.log(`Ollama no respondió: descarga el modelo después con «ollama pull ${a.modelo}».`);
        continue;
      }
      io.log(`Descargando ${a.modelo} (puede tardar según tu conexión)…`);
      const codigo = await io.run(io.ollama(), ['pull', a.modelo]);
      io.log(codigo === 0 ? `${a.modelo} listo.` : `La descarga terminó con código ${codigo}. Reintenta con «ollama pull ${a.modelo}».`);
      hecho.push(a.tipo);
    } else if (a.tipo === 'colonias') {
      io.log('Preparando las colonias del INE…');
      const codigo = await io.colonias();
      io.log(codigo === 0 ? 'Colonias listas.' : `No se pudieron preparar (código ${codigo}). Reintenta con «npm run colonias».`);
      hecho.push(a.tipo);
    }
  }
  return hecho;
}

/**
 * El asistente completo: decide si pregunta, pregunta, ejecuta y recuerda que ya corrió.
 * Devuelve por qué no se preguntó (o null si se preguntó).
 */
export async function asistente({ opciones, entorno, estadoArchivo, ask, log, io }) {
  const estado = leerEstado(estadoArchivo);
  const motivo = motivoNoPregunta({ ...opciones, estado });
  if (motivo) return motivo;
  const ids = preguntasPara(entorno, opciones);
  if (ids.length)
    log(
      `Preguntas opcionales de ${opciones.configurar ? 'configuración' : 'primer arranque'} (cada una se puede omitir; se repiten con: npm start -- --configurar).`,
    );
  const respuestas = await preguntar(ids, entorno, { ask, log });
  const acciones = accionesPara(respuestas, entorno);
  if (acciones.length) log('');
  const hecho = await ejecutar(acciones, io);
  guardarEstado(estadoArchivo, { version: 1, fecha: new Date().toISOString(), preguntas: ids, respuestas, hecho });
  return null;
}
