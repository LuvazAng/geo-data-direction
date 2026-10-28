import type { StyleSpecification } from 'maplibre-gl';

// Estilo del mapa base y elementos visuales sueltos (flecha de sentido, marcas de inicio y final).

export const LANE_PX = 4;

/** Opacidad de una capa de trazos: general × la del trazo × atenuado si hay otro seleccionado. */
export const fade = (all: number, dim: number, full: number): ['*', number, ['get', string], ['case', ['get', string], number, number]] => [
  '*',
  all,
  ['get', 'opacity'],
  ['case', ['get', 'dim'], dim, full],
];

const raster = (tiles: string[], attribution: string, maxzoom = 19) => ({
  type: 'raster' as const,
  tiles,
  tileSize: 256,
  attribution,
  maxzoom,
});

const ESRI = (service: string) => [`https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`];
const ESRI_ATTR = 'Esri, Maxar, Earthstar Geographics, HERE, © OpenStreetMap';

export const STYLE: StyleSpecification = {
  version: 8,
  // tipografía para los nombres de colonias
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    calles: raster(['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], '© OpenStreetMap'),
    oscuro: raster(ESRI('Canvas/World_Dark_Gray_Base'), ESRI_ATTR, 16),
    oscuroRef: raster(ESRI('Canvas/World_Dark_Gray_Reference'), ESRI_ATTR, 16),
    satelite: raster(ESRI('World_Imagery'), ESRI_ATTR),
    vialidades: raster(ESRI('Reference/World_Transportation'), ESRI_ATTR),
    lugares: raster(ESRI('Reference/World_Boundaries_and_Places'), ESRI_ATTR),
  },
  layers: [
    { id: 'calles', type: 'raster', source: 'calles' },
    { id: 'oscuro', type: 'raster', source: 'oscuro', layout: { visibility: 'none' } },
    { id: 'oscuroRef', type: 'raster', source: 'oscuroRef', layout: { visibility: 'none' } },
    { id: 'satelite', type: 'raster', source: 'satelite', layout: { visibility: 'none' } },
    { id: 'vialidades', type: 'raster', source: 'vialidades', layout: { visibility: 'none' } },
    { id: 'lugares', type: 'raster', source: 'lugares', layout: { visibility: 'none' } },
  ],
};

export const LABEL_FONT = ['Open Sans Semibold'];

/** Flecha ">" blanca; se usa como SDF para poder colorearla por ruta. */
export function arrowImage() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(10, 7);
  ctx.lineTo(22, 16);
  ctx.lineTo(10, 25);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

export function endpointEl(kind: 'start' | 'end', letter: string) {
  const el = document.createElement('div');
  el.className = `endpoint endpoint-${kind}`;
  el.innerHTML = `<span class="endpoint-dot"></span><span class="endpoint-label">${letter} · ${kind === 'start' ? 'INICIO' : 'FINAL'}</span>`;
  return el;
}
