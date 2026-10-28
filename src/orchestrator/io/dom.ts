import { JSDOM } from 'jsdom';

// src/core/kml.ts usa DOMParser y XMLSerializer del navegador. En Node los da jsdom,
// así el orquestador reutiliza el mismo lector/escritor de KML que la app.
const { window } = new JSDOM('');
const g = globalThis as Record<string, unknown>;
g.DOMParser ??= window.DOMParser;
g.XMLSerializer ??= window.XMLSerializer;

/** HTML a documento, sin ejecutar scripts ni cargar recursos externos. */
export const parseHtml = (html: string, url: string): Document => new JSDOM(html, { url }).window.document;
