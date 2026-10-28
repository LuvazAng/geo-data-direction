import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Coord, ColoniasData, ColoniasRuta } from '@core';
import type { MapRoute } from '../state/derived';
import type { Basemap } from './basemap';
import { EMPTY, coloniasRutaData, editData, lines, routesData, type FC } from './mapData';
import { LABEL_FONT, LANE_PX, STYLE, arrowImage, endpointEl, fade } from './mapStyle';

interface Props {
  routes: MapRoute[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  basemap: Basemap;
  /** Separa visualmente trazos encimados: cada línea se dibuja a la derecha de su sentido. */
  lanes: boolean;
  /** Opacidad de todos los trazos (se multiplica por la de cada uno). */
  opacity: number;
  /** Cambiar `nonce` dispara un fitBounds sobre `ids`. */
  fit: { ids: string[]; nonce: number };
  /** Ruta en modo edición: se muestran sus vértices para moverlos, agregarlos o quitarlos. */
  editId: string | null;
  onEdit: (id: string, coords: Coord[]) => void;
  /** Puntos donde un tramo corto sale / se reincorpora a la ruta principal. */
  junctions: { coord: Coord; label: string }[];
  /** Vista previa del ajuste a calles: trazo ajustado y tramos que se quedan igual. */
  preview: { coords: Coord[]; unmatched: Coord[][] } | null;
  /** Todas las colonias del INE (null mientras cargan o si no hay archivo). */
  colonias: ColoniasData | null;
  /** Mostrar todas las colonias de fondo. */
  showColonias: boolean;
  /** Colonias por las que pasa el trazo seleccionado: se pintan con su nombre. */
  coloniasRuta: ColoniasRuta | null;
}

maplibregl.setWorkerUrl(workerUrl);

export function MapView({
  routes,
  selectedId,
  onSelect,
  basemap,
  lanes,
  opacity,
  fit,
  editId,
  onEdit,
  junctions,
  preview,
  colonias,
  showColonias,
  coloniasRuta,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const junctionsRef = useRef<maplibregl.Marker[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const routesRef = useRef(routes);
  routesRef.current = routes;
  const editRef = useRef({ editId, onEdit, selectedId });
  editRef.current = { editId, onEdit, selectedId };

  // Inicialización
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: STYLE,
      center: [-99.1, 18.8], // Morelos
      zoom: 9,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      map.addImage('arrow', arrowImage(), { sdf: true });

      // Colonias, debajo de los trazos: todas de fondo (opcional) y las que cruza el trazo seleccionado
      map.addSource('colonias', { type: 'geojson', data: EMPTY });
      map.addSource('colonias-ruta', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'colonias-fill',
        type: 'fill',
        source: 'colonias',
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#94a3b8', 'fill-opacity': 0.08 },
      });
      map.addLayer({
        id: 'colonias-line',
        type: 'line',
        source: 'colonias',
        layout: { visibility: 'none' },
        paint: { 'line-color': '#64748b', 'line-width': 0.8, 'line-opacity': 0.7 },
      });
      map.addLayer({
        id: 'colonias-ruta-fill',
        type: 'fill',
        source: 'colonias-ruta',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['%', ['get', 'orden'], 2], 0], 0.16, 0.28] },
      });
      map.addLayer({
        id: 'colonias-ruta-line',
        type: 'line',
        source: 'colonias-ruta',
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.9 },
      });

      map.addSource('routes', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'routes-casing',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#0b1220',
          'line-width': ['case', ['get', 'selected'], 9, 6],
          'line-opacity': fade(1, 0.15, 0.55),
          'line-offset': LANE_PX,
        },
      });
      map.addLayer({
        id: 'routes-line',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'selected'], 5, ['get', 'minor'], 2, 3],
          'line-opacity': fade(1, 0.35, 1),
          'line-offset': LANE_PX,
        },
      });
      map.addLayer({
        id: 'routes-arrows',
        type: 'symbol',
        source: 'routes',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 70,
          'icon-image': 'arrow',
          'icon-size': ['case', ['get', 'selected'], 0.75, 0.55],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotation-alignment': 'map',
          'icon-offset': [0, LANE_PX / 0.6],
        },
        paint: {
          'icon-color': ['get', 'color'],
          'icon-halo-color': '#0b1220',
          'icon-halo-width': 1.5,
          'icon-opacity': fade(1, 0.35, 1),
        },
      });

      // Tramos en contraflujo: rojo punteado encima del trazo
      map.addSource('against', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'against-line',
        type: 'line',
        source: 'against',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': '#ef4444',
          'line-width': 4,
          'line-dasharray': [1.2, 1],
          'line-offset': LANE_PX,
          'line-opacity': fade(1, 0.3, 1),
        },
      });

      // Vista previa del ajuste a calles (sin desplazamiento de carril: es justo lo que se guardará)
      map.addSource('snap-preview', { type: 'geojson', data: EMPTY });
      map.addSource('snap-unmatched', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'snap-preview-casing',
        type: 'line',
        source: 'snap-preview',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0b1220', 'line-width': 7, 'line-opacity': 0.75 },
      });
      map.addLayer({
        id: 'snap-preview',
        type: 'line',
        source: 'snap-preview',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 3 },
      });
      map.addLayer({
        id: 'snap-unmatched',
        type: 'line',
        source: 'snap-unmatched',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': '#f472b6', 'line-width': 4, 'line-dasharray': [1.2, 1] },
      });

      // Edición: puntos medios (arrastrar = insertar vértice) y vértices (mover / quitar)
      map.addSource('edit-mids', { type: 'geojson', data: EMPTY });
      map.addSource('edit-vertices', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'edit-mids',
        type: 'circle',
        source: 'edit-mids',
        minzoom: 14,
        paint: {
          'circle-radius': 4,
          'circle-color': '#ffffff',
          'circle-opacity': 0.6,
          'circle-stroke-color': '#0b1220',
          'circle-stroke-width': 1,
        },
      });
      map.addLayer({
        id: 'edit-vertices',
        type: 'circle',
        source: 'edit-vertices',
        minzoom: 12,
        paint: { 'circle-radius': 5, 'circle-color': '#facc15', 'circle-stroke-color': '#0b1220', 'circle-stroke-width': 2 },
      });

      // Nombres de colonias encima de todo; los de la ruta seleccionada tienen prioridad
      const label = (size: number) => ({
        'text-field': ['get', 'nombre'] as maplibregl.ExpressionSpecification,
        'text-font': LABEL_FONT,
        'text-size': size,
        'text-max-width': 8,
      });
      map.addLayer({
        id: 'colonias-label',
        type: 'symbol',
        source: 'colonias',
        minzoom: 14,
        layout: { ...label(10), visibility: 'none' },
        paint: { 'text-color': '#334155', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
      });
      map.addLayer({
        id: 'colonias-ruta-label',
        type: 'symbol',
        source: 'colonias-ruta',
        minzoom: 12,
        layout: label(11),
        paint: { 'text-color': '#0b1220', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      });

      const editedRoute = () => routesRef.current.find((r) => r.id === editRef.current.editId);
      const render = (id: string, coords: Coord[]) => {
        const d = editData(coords);
        (map.getSource('edit-vertices') as GeoJSONSource).setData(d.vertices);
        (map.getSource('edit-mids') as GeoJSONSource).setData(d.mids);
        (map.getSource('routes') as GeoJSONSource).setData(routesData(routesRef.current, editRef.current.selectedId, { id, coords }));
      };
      const startDrag = (e: maplibregl.MapLayerMouseEvent, kind: 'vertex' | 'mid') => {
        const route = editedRoute();
        const i = Number(e.features?.[0]?.properties?.i);
        if (!route || Number.isNaN(i) || e.originalEvent.button !== 0) return;
        e.preventDefault(); // evita que el mapa se desplace mientras se arrastra
        const coords = route.coords.slice();
        let idx = i;
        if (kind === 'mid') coords.splice((idx = i + 1), 0, [e.lngLat.lng, e.lngLat.lat]);
        let moved = kind === 'mid';
        map.getCanvas().style.cursor = 'grabbing';
        const onMove = (ev: maplibregl.MapMouseEvent) => {
          coords[idx] = [ev.lngLat.lng, ev.lngLat.lat];
          moved = true;
          render(route.id, coords);
        };
        map.on('mousemove', onMove);
        map.once('mouseup', () => {
          map.off('mousemove', onMove);
          map.getCanvas().style.cursor = '';
          if (moved) editRef.current.onEdit(route.id, coords);
        });
      };
      map.on('mousedown', 'edit-vertices', (e: maplibregl.MapLayerMouseEvent) => startDrag(e, 'vertex'));
      map.on('mousedown', 'edit-mids', (e: maplibregl.MapLayerMouseEvent) => startDrag(e, 'mid'));
      // Clic derecho sobre un vértice: quitarlo
      map.on('contextmenu', 'edit-vertices', (e: maplibregl.MapLayerMouseEvent) => {
        const route = editedRoute();
        const i = Number(e.features?.[0]?.properties?.i);
        if (!route || Number.isNaN(i) || route.coords.length <= 2) return;
        e.preventDefault();
        editRef.current.onEdit(
          route.id,
          route.coords.filter((_, k) => k !== i),
        );
      });
      for (const layer of ['edit-vertices', 'edit-mids']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'grab'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }

      map.on('click', 'routes-line', (e: maplibregl.MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (id && !editRef.current.editId) onSelectRef.current(String(id));
      });
      map.on('mouseenter', 'routes-line', () => {
        if (!editRef.current.editId) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'routes-line', () => {
        if (!editRef.current.editId) map.getCanvas().style.cursor = '';
      });

      setReady(true);
    });

    mapRef.current = map;
    return () => {
      setReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /** Ejecuta `fn` sólo cuando el mapa ya cargó sus capas. */
  const whenReady = (fn: (map: maplibregl.Map) => void) => {
    if (ready && mapRef.current) fn(mapRef.current);
  };

  // Datos de rutas, vértices en edición y marcadores INICIO/FINAL
  useEffect(
    () =>
      whenReady((map) => {
        const visible = routes.filter((r) => r.visible);
        (map.getSource('routes') as GeoJSONSource).setData(routesData(routes, selectedId));
        (map.getSource('against') as GeoJSONSource).setData({
          type: 'FeatureCollection',
          features: visible.flatMap((r) =>
            (r.against ?? []).map((coords) => ({
              type: 'Feature' as const,
              properties: { dim: !!selectedId && r.id !== selectedId, opacity: r.opacity },
              geometry: { type: 'LineString' as const, coordinates: coords },
            })),
          ),
        });
        const editing = visible.find((r) => r.id === editId);
        const d = editData(editing ? editing.coords : null);
        (map.getSource('edit-vertices') as GeoJSONSource).setData(d.vertices);
        (map.getSource('edit-mids') as GeoJSONSource).setData(d.mids);

        // la ruta seleccionada encima
        const ordered = [...visible].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId));
        markersRef.current.forEach((m) => m.remove());
        markersRef.current = ordered.flatMap((r) =>
          (['start', 'end'] as const).map((kind) => {
            const el = endpointEl(kind, r.letter);
            el.style.setProperty('--route-color', r.color);
            el.style.setProperty('--route-opacity', String(r.opacity));
            if (selectedId && r.id !== selectedId) el.classList.add('dim');
            // en edición los marcadores no deben tapar los vértices de los extremos
            if (editId) el.style.pointerEvents = 'none';
            el.addEventListener('click', (ev) => {
              ev.stopPropagation();
              onSelectRef.current(r.id);
            });
            return new maplibregl.Marker({ element: el, anchor: 'left', offset: [-8, 0] })
              .setLngLat(kind === 'start' ? r.coords[0] : r.coords[r.coords.length - 1])
              .addTo(map);
          }),
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, routes, selectedId, editId],
  );

  // Puntos de salida / reincorporación de un tramo corto
  useEffect(
    () =>
      whenReady((map) => {
        junctionsRef.current.forEach((m) => m.remove());
        junctionsRef.current = junctions.map(({ coord, label }) => {
          const el = document.createElement('div');
          el.className = 'junction';
          el.innerHTML = `<span class="junction-dot"></span><span class="junction-label"></span>`;
          el.querySelector('.junction-label')!.textContent = label;
          return new maplibregl.Marker({ element: el, anchor: 'left', offset: [-7, 0] }).setLngLat(coord).addTo(map);
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, junctions],
  );

  // Vista previa del ajuste a calles
  useEffect(
    () =>
      whenReady((map) => {
        (map.getSource('snap-preview') as GeoJSONSource).setData(lines(preview ? [preview.coords] : []));
        (map.getSource('snap-unmatched') as GeoJSONSource).setData(lines(preview?.unmatched ?? []));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, preview],
  );

  // Todas las colonias de fondo (los datos se pasan al mapa la primera vez que se muestran)
  useEffect(
    () =>
      whenReady((map) => {
        if (showColonias && colonias) (map.getSource('colonias') as GeoJSONSource).setData(colonias as unknown as FC);
        for (const id of ['colonias-fill', 'colonias-line', 'colonias-label']) {
          map.setLayoutProperty(id, 'visibility', showColonias && colonias ? 'visible' : 'none');
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, colonias, showColonias],
  );

  // Colonias por las que pasa el trazo seleccionado, del color del trazo
  const coloniaById = useMemo(() => new Map((colonias?.features ?? []).map((f) => [f.properties.id, f])), [colonias]);
  const selectedColor = routes.find((r) => r.id === selectedId)?.color ?? '#3b82f6';
  useEffect(
    () =>
      whenReady((map) => {
        (map.getSource('colonias-ruta') as GeoJSONSource).setData(coloniasRutaData(coloniasRuta, coloniaById, selectedColor));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, coloniasRuta, coloniaById, selectedColor],
  );

  // Mapa base
  useEffect(
    () =>
      whenReady((map) => {
        const show = (id: string, on: boolean) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
        show('calles', basemap === 'calles');
        show('oscuro', basemap === 'oscuro');
        show('oscuroRef', basemap === 'oscuro');
        show('satelite', basemap === 'satelite');
        show('vialidades', basemap === 'satelite');
        show('lugares', basemap === 'satelite');
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, basemap],
  );

  // Carriles
  useEffect(
    () =>
      whenReady((map) => {
        const px = lanes ? LANE_PX : 0;
        map.setPaintProperty('routes-casing', 'line-offset', px);
        map.setPaintProperty('routes-line', 'line-offset', px);
        map.setPaintProperty('against-line', 'line-offset', px);
        map.setLayoutProperty('routes-arrows', 'icon-offset', [0, px / 0.6]);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, lanes],
  );

  // Opacidad general de los trazos (los marcadores INICIO/FINAL la toman de la variable CSS)
  useEffect(
    () =>
      whenReady((map) => {
        map.setPaintProperty('routes-casing', 'line-opacity', fade(opacity, 0.15, 0.55));
        map.setPaintProperty('routes-line', 'line-opacity', fade(opacity, 0.35, 1));
        map.setPaintProperty('routes-arrows', 'icon-opacity', fade(opacity, 0.35, 1));
        map.setPaintProperty('against-line', 'line-opacity', fade(opacity, 0.3, 1));
        containerRef.current?.style.setProperty('--routes-opacity', String(opacity));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, opacity],
  );

  // Encuadre
  useEffect(
    () =>
      whenReady((map) => {
        const coords = routesRef.current.filter((r) => fit.ids.includes(r.id)).flatMap((r) => r.coords);
        if (coords.length === 0) return;
        const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
        map.fitBounds(bounds, { padding: 60, maxZoom: 17, duration: 600 });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, fit.nonce],
  );

  return <div ref={containerRef} className="map" />;
}
