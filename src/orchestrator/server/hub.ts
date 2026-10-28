import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { ServerEvent, Snapshot } from '@protocol';

// Server-Sent Events con recuperación. Cada evento lleva id "<bootId>:<seq>". Al reconectarse,
// el navegador manda Last-Event-ID: si es de esta instancia y sigue en el búfer se reenvía lo que
// se perdió; si no (servidor reiniciado o hueco demasiado grande) se manda el estado completo.

interface Buffered {
  seq: number;
  type: string;
  json: string;
}

export class EventHub {
  readonly bootId = randomUUID().slice(0, 8);
  private seq = 0;
  private buffer: Buffered[] = [];
  private clients = new Set<ServerResponse>();
  private heartbeat?: NodeJS.Timeout;

  constructor(
    private readonly snapshot: () => Snapshot,
    private readonly maxBuffer: number,
    heartbeatMs = 15_000,
  ) {
    if (heartbeatMs > 0) {
      // Evento con nombre pero sin id: el navegador sabe que la conexión sigue viva y el
      // Last-Event-ID (punto de reconexión) no cambia.
      this.heartbeat = setInterval(() => {
        for (const c of this.clients) c.write(`event: latido\ndata: ${Date.now()}\n\n`);
      }, heartbeatMs);
      this.heartbeat.unref();
    }
  }

  get connected() {
    return this.clients.size;
  }

  publish(event: ServerEvent) {
    const b: Buffered = { seq: ++this.seq, type: event.type, json: JSON.stringify(event.data) };
    this.buffer.push(b);
    if (this.buffer.length > this.maxBuffer) this.buffer.splice(0, this.buffer.length - this.maxBuffer);
    for (const c of this.clients) this.write(c, b);
  }

  /**
   * Evento que no se guarda para reenviar y no lleva id (no mueve el punto de reconexión): sólo lo
   * reciben los navegadores conectados ahora. Para el texto en streaming, que llega muchas veces por
   * segundo; quien se pierde un trozo se pone al día con la siguiente versión completa.
   */
  publishVolatile(event: ServerEvent) {
    const chunk = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    for (const c of this.clients) c.write(chunk);
  }

  private write(res: ServerResponse, b: Buffered) {
    res.write(`id: ${this.bootId}:${b.seq}\nevent: ${b.type}\ndata: ${b.json}\n\n`);
  }

  /** Conecta un navegador. Devuelve cómo se sincronizó (para el registro). */
  attach(res: ServerResponse, lastEventId: string | undefined): 'reenvio' | 'estado-completo' {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));

    const [boot, seqText] = (lastEventId ?? '').split(':');
    const seq = Number(seqText);
    const oldest = this.buffer[0]?.seq ?? this.seq + 1;
    if (boot === this.bootId && Number.isInteger(seq) && seq >= oldest - 1 && seq <= this.seq) {
      for (const b of this.buffer) if (b.seq > seq) this.write(res, b);
      return 'reenvio';
    }
    // estado completo: lleva el id del último evento para que la próxima reconexión sea incremental
    res.write(`id: ${this.bootId}:${this.seq}\nevent: snapshot\ndata: ${JSON.stringify(this.snapshot())}\n\n`);
    return 'estado-completo';
  }

  close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const c of this.clients) c.end();
    this.clients.clear();
  }
}
