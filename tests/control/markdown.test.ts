import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown, parseMarkdown } from '../../src/control/markdown';

const html = (text: string, streaming = false) => renderToStaticMarkup(createElement(Markdown, { text, streaming }));

describe('markdown de las respuestas de Qwen', () => {
  it('formato en línea: negritas, cursivas, tachado, código y enlaces http(s)', () => {
    expect(html('El lote **SUR** tiene *24* rutas, _5_ en ~~error~~ revisión; usa `procesa la ruta 2`.')).toBe(
      '<div class="cc-md"><p>El lote <strong>SUR</strong> tiene <em>24</em> rutas, <em>5</em> en <del>error</del> revisión; usa <code>procesa la ruta 2</code>.</p></div>',
    );
    expect(html('Ver [la fuente](https://sites.google.com/x) o https://movilidad.morelos.gob.mx.')).toContain(
      '<a href="https://sites.google.com/x" target="_blank" rel="noopener noreferrer">la fuente</a> o <a href="https://movilidad.morelos.gob.mx" target="_blank" rel="noopener noreferrer">https://movilidad.morelos.gob.mx</a>.',
    );
    // no se rompe lo que no es marca: guiones bajos dentro de palabras, multiplicaciones, escapes
    expect(html('RUTAS_ORQUESTADOR y 5 * 3 * 2 y \\*literal\\*')).toBe('<div class="cc-md"><p>RUTAS_ORQUESTADOR y 5 * 3 * 2 y *literal*</p></div>');
  });

  it('nunca interpreta HTML ni enlaces que no sean http(s)', () => {
    const out = html('<img src=x onerror=alert(1)> [clic](javascript:alert(1)) <script>x</script>');
    expect(out).not.toMatch(/<img|<script|href="javascript/);
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('títulos, párrafos con saltos de línea, citas, separadores y bloques de código', () => {
    const out = html('# Resumen\nLínea uno\nLínea dos\n\n> nota **importante**\n\n---\n\n```json\n{ "a": 1 }\n```');
    expect(out).toBe(
      '<div class="cc-md"><h3>Resumen</h3><p>Línea uno<br/>Línea dos</p><blockquote><p>nota <strong>importante</strong></p></blockquote><hr/><pre data-lang="json"><code>{ &quot;a&quot;: 1 }</code></pre></div>',
    );
  });

  it('listas: viñetas, numeradas, anidadas, separadas por líneas en blanco y de tareas', () => {
    expect(html('- uno\n- dos\n  - dos.a\n  - dos.b\n- tres')).toBe(
      '<div class="cc-md"><ul><li>uno</li><li>dos<ul><li>dos.a</li><li>dos.b</li></ul></li><li>tres</li></ul></div>',
    );
    expect(html('1. **Analizar**: la pregunta\n\n2. **Revisar** el estado\n    *   SUR: 24 rutas\n3. Responder')).toBe(
      '<div class="cc-md"><ol><li><strong>Analizar</strong>: la pregunta</li><li><strong>Revisar</strong> el estado<ul><li>SUR: 24 rutas</li></ul></li><li>Responder</li></ol></div>',
    );
    expect(html('3) tercero\n4) cuarto')).toContain('<ol start="3">');
    expect(html('- [x] hecho\n- [ ] falta')).toBe(
      '<div class="cc-md"><ul><li class="task"><input type="checkbox" disabled="" readOnly="" checked=""/>hecho</li><li class="task"><input type="checkbox" disabled="" readOnly=""/>falta</li></ul></div>',
    );
  });

  it('tablas con alineación', () => {
    const out = html('| Lote | Rutas |\n|:-----|------:|\n| SUR | 24 |\n| ORIENTE | 58 |');
    expect(out).toContain('<th style="text-align:left">Lote</th><th style="text-align:right">Rutas</th>');
    expect(out).toContain('<td style="text-align:left">ORIENTE</td><td style="text-align:right">58</td>');
  });

  it('texto a medias (streaming): marcas sin cerrar se ven tal cual; un bloque de código abierto llega hasta el final', () => {
    expect(html('El lote **SU', true)).toBe('<div class="cc-md streaming"><p>El lote **SU</p></div>');
    expect(parseMarkdown('Ejemplo:\n```ts\nconst a = 1;')).toEqual([
      { t: 'p', lines: ['Ejemplo:'] },
      { t: 'code', lang: 'ts', text: 'const a = 1;' },
    ]);
    // la tabla todavía sin su línea separadora es un párrafo
    expect(parseMarkdown('| Lote | Rutas |')).toEqual([{ t: 'p', lines: ['| Lote | Rutas |'] }]);
  });
});
