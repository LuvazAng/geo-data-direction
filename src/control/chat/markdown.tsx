import { Fragment, useMemo, type ReactNode } from 'react';

// Markdown de las respuestas de Qwen convertido a elementos de React: nunca HTML crudo (lo que
// escribe el modelo se muestra como texto). Cubre lo que suele usar: títulos, párrafos, negritas,
// cursivas, tachado, código en línea y en bloque, listas (anidadas, numeradas, de tareas), citas,
// tablas, separadores y enlaces http(s). Tolera texto a medias mientras llega en streaming: una
// marca sin cerrar se muestra tal cual y un bloque de código sin cerrar llega hasta el final.

type Align = 'left' | 'center' | 'right' | undefined;

export type MdBlock =
  | { t: 'p'; lines: string[] }
  | { t: 'h'; level: number; text: string }
  | { t: 'code'; lang: string; text: string }
  | { t: 'hr' }
  | { t: 'quote'; blocks: MdBlock[] }
  | { t: 'list'; ordered: boolean; start: number; items: { blocks: MdBlock[]; check?: boolean }[] }
  | { t: 'table'; head: string[]; align: Align[]; rows: string[][] };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const indentOf = (l: string) => l.length - l.trimStart().length;
const isTableStart = (lines: string[], i: number) =>
  lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && TABLE_SEP.test(lines[i + 1]);
const startsBlock = (lines: string[], i: number) =>
  FENCE.test(lines[i]) || HEADING.test(lines[i]) || HR.test(lines[i]) || QUOTE.test(lines[i]) || ITEM.test(lines[i]) || isTableStart(lines, i);

function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

const alignOf = (c: string): Align => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : undefined);

export function parseMarkdown(src: string): MdBlock[] {
  return blocksOf(src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'));
}

function blocksOf(lines: string[]): MdBlock[] {
  const out: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = FENCE.exec(line))) {
      const fence = m[1];
      const body: string[] = [];
      const cut = Math.min(indentOf(line), 3);
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence)) {
        const l = lines[i++];
        body.push(l.slice(Math.min(cut, indentOf(l))));
      }
      i++; // cierre (si ya llegó)
      out.push({ t: 'code', lang: m[2], text: body.join('\n') });
    } else if ((m = HEADING.exec(line))) {
      out.push({ t: 'h', level: m[1].length, text: m[2] });
      i++;
    } else if (HR.test(line)) {
      out.push({ t: 'hr' });
      i++;
    } else if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || !startsBlock(lines, i))) {
        body.push(QUOTE.exec(lines[i])?.[1] ?? lines[i]);
        i++;
      }
      out.push({ t: 'quote', blocks: blocksOf(body) });
    } else if (isTableStart(lines, i)) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map(alignOf);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      out.push({ t: 'table', head, align, rows });
    } else if (ITEM.test(line)) {
      i = listAt(lines, i, out);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines, i))) para.push(lines[i++].trim());
      out.push({ t: 'p', lines: para });
    }
  }
  return out;
}

/** Lista que empieza en `start`; devuelve dónde sigue el texto. Los niveles se reconocen por sangría. */
function listAt(lines: string[], start: number, out: MdBlock[]): number {
  const first = ITEM.exec(lines[start])!;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const list: Extract<MdBlock, { t: 'list' }> = { t: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, items: [] };
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || Math.abs(m[1].length - indent) > 1 || /\d/.test(m[2]) !== ordered) break;
    const contentIndent = m[1].length + m[2].length + 1;
    const body = [m[3]];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && indentOf(lines[j]) > indent + 1) {
          for (; i < j; i++) body.push('');
          continue;
        }
        const sibling = j < lines.length ? ITEM.exec(lines[j]) : null;
        if (sibling && Math.abs(sibling[1].length - indent) <= 1 && /\d/.test(sibling[2]) === ordered) i = j;
        break;
      }
      if (indentOf(l) > indent + 1) body.push(l.slice(Math.min(indentOf(l), contentIndent)));
      else if (!startsBlock(lines, i))
        body.push(l.trim()); // continuación del mismo párrafo
      else break;
      i++;
    }
    const task = /^\[([ xX])\]\s+/.exec(body[0]);
    if (task) body[0] = body[0].slice(task[0].length);
    list.items.push({ blocks: blocksOf(body), ...(task && { check: task[1] !== ' ' }) });
  }
  out.push(list);
  return i;
}

// 1 escape · 2-3 código · 4 negrita ** · 5 negrita __ · 6 tachado · 7 cursiva * · 8 cursiva _ · 9-10 enlace · 11 URL suelta
const INLINE =
  /\\([\\`*_{}[\]()#+\-.!~|>])|(`+)([^`]|[^`][\s\S]*?[^`])\2(?!`)|\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__(?!\w)|~~(?=\S)([\s\S]*?\S)~~|\*(?=[^\s*])([\s\S]*?[^\s*])\*|(?<!\w)_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)|\[([^\]\n]+)\]\(\s*(https?:\/\/[^\s)]+)\s*\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"»])/g;

export function inline(s: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const k = `${key}.${n++}`;
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) out.push(<code key={k}>{m[3]}</code>);
    else if (m[4] !== undefined || m[5] !== undefined) out.push(<strong key={k}>{inline(m[4] ?? m[5], k)}</strong>);
    else if (m[6] !== undefined) out.push(<del key={k}>{inline(m[6], k)}</del>);
    else if (m[7] !== undefined || m[8] !== undefined) out.push(<em key={k}>{inline(m[7] ?? m[8], k)}</em>);
    else if (m[9] !== undefined)
      out.push(
        <a key={k} href={m[10]} target="_blank" rel="noopener noreferrer">
          {inline(m[9], k)}
        </a>,
      );
    else
      out.push(
        <a key={k} href={m[11]} target="_blank" rel="noopener noreferrer">
          {m[11]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const lines = (ls: string[], key: string) =>
  ls.map((l, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {inline(l, `${key}.${i}`)}
    </Fragment>
  ));

const HEADINGS = ['h3', 'h4', 'h5', 'h6', 'h6', 'h6'] as const;

function render(blocks: MdBlock[], key: string, tight = false): ReactNode[] {
  return blocks.map((b, i) => {
    const k = `${key}.${i}`;
    switch (b.t) {
      case 'p':
        // en una lista compacta, el primer párrafo de cada elemento va sin margen
        return tight && i === 0 ? <Fragment key={k}>{lines(b.lines, k)}</Fragment> : <p key={k}>{lines(b.lines, k)}</p>;
      case 'h': {
        const Tag = HEADINGS[b.level - 1];
        return <Tag key={k}>{inline(b.text, k)}</Tag>;
      }
      case 'code':
        return (
          <pre key={k} data-lang={b.lang || undefined}>
            <code>{b.text}</code>
          </pre>
        );
      case 'hr':
        return <hr key={k} />;
      case 'quote':
        return <blockquote key={k}>{render(b.blocks, k)}</blockquote>;
      case 'list': {
        const items = b.items.map((it, j) => (
          <li key={j} className={it.check !== undefined ? 'task' : undefined}>
            {it.check !== undefined && <input type="checkbox" checked={it.check} disabled readOnly />}
            {render(it.blocks, `${k}.${j}`, true)}
          </li>
        ));
        return b.ordered ? (
          <ol key={k} start={b.start !== 1 ? b.start : undefined}>
            {items}
          </ol>
        ) : (
          <ul key={k}>{items}</ul>
        );
      }
      case 'table':
        return (
          <div key={k} className="cc-md-table">
            <table>
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} style={{ textAlign: b.align[j] }}>
                      {inline(c, `${k}.h${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>
                    {b.head.map((_, j) => (
                      <td key={j} style={{ textAlign: b.align[j] }}>
                        {inline(r[j] ?? '', `${k}.${ri}.${j}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

/** Texto en markdown. Con `streaming`, muestra un cursor al final (el texto sigue llegando). */
export function Markdown({ text, streaming, className }: { text: string; streaming?: boolean; className?: string }) {
  const nodes = useMemo(() => render(parseMarkdown(text), 'b'), [text]);
  return <div className={['cc-md', className, streaming && 'streaming'].filter(Boolean).join(' ')}>{nodes}</div>;
}
