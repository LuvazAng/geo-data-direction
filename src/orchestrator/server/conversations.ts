import { randomUUID } from 'node:crypto';
import { CONVERSACION_ANTERIOR, type ChatBlock, type ChatMessage, type Conversacion } from '@protocol';
import { ActionError } from '../errors';
import type { EventHub } from './hub';
import type { CenterStore } from './persist';

const NUEVO_CHAT = 'Nuevo chat';

function newConversation(): Conversacion {
  const now = new Date().toISOString();
  return { id: `c-${randomUUID()}`, titulo: NUEVO_CHAT, creadaEn: now, actualizadaEn: now, mensajes: 0 };
}

/** Un mensaje del chat, listo para publicarse. */
export function newMessage(
  rol: ChatMessage['rol'],
  texto: string,
  conversacion: string,
  bloques: ChatBlock[] = [],
  interpretacion?: ChatMessage['interpretacion'],
): ChatMessage {
  return { id: randomUUID(), ts: new Date().toISOString(), rol, texto, bloques, conversacion, ...(interpretacion && { interpretacion }) };
}

/** Las conversaciones del chat: se guardan en disco y cada cambio llega al navegador. */
export class Conversations {
  private conversations: Conversacion[];

  constructor(
    private readonly store: CenterStore,
    private readonly hub: EventHub,
    private readonly chatRetention: number,
  ) {
    this.conversations = this.load();
  }

  /** Conversaciones guardadas; los mensajes de antes de que existieran quedan en «Mensajes anteriores». */
  private load(): Conversacion[] {
    const list = this.store.loadConversations();
    const before = list.length;
    if (!list.some((c) => c.id === CONVERSACION_ANTERIOR)) {
      const old = this.store.loadChat(this.chatRetention, CONVERSACION_ANTERIOR);
      if (old.length)
        list.push({
          id: CONVERSACION_ANTERIOR,
          titulo: 'Mensajes anteriores',
          creadaEn: old[0].ts,
          actualizadaEn: old[old.length - 1].ts,
          mensajes: old.length,
        });
    }
    if (!list.length) list.push(newConversation());
    if (list.length !== before) this.store.saveConversations(list);
    return list;
  }

  /** La más reciente primero. */
  list(): Conversacion[] {
    return [...this.conversations].sort((a, b) => b.actualizadaEn.localeCompare(a.actualizadaEn));
  }

  /** Conversación nueva (sin historial para Qwen). Si ya hay una vacía se usa esa: no se acumulan vacías. */
  create(): Conversacion {
    let c = this.conversations.find((x) => x.mensajes === 0);
    if (c) c.actualizadaEn = new Date().toISOString();
    else this.conversations.push((c = newConversation()));
    this.save(c);
    return c;
  }

  /** La conversación indicada (debe existir) o, si no se indicó, la más reciente. */
  get(id?: unknown): Conversacion {
    if (id === undefined || id === null || id === '') return this.list()[0] ?? this.create();
    const c = this.conversations.find((x) => x.id === id);
    if (!c) throw new ActionError('No existe esa conversación', 404);
    return c;
  }

  private save(c: Conversacion) {
    this.store.saveConversations(this.conversations);
    this.hub.publish({ type: 'chat.conversation', data: c });
  }

  /** Un mensaje terminado más en la conversación; el primero que escribe el operador le da título. */
  touch(m: ChatMessage) {
    const c = this.conversations.find((x) => x.id === (m.conversacion ?? CONVERSACION_ANTERIOR));
    if (!c) return;
    c.actualizadaEn = new Date().toISOString();
    c.mensajes++;
    if (c.titulo === NUEVO_CHAT && m.rol === 'usuario' && m.texto) {
      const t = m.texto.replace(/^▸\s*/, '').replace(/\s+/g, ' ').trim();
      c.titulo = t.length > 48 ? `${t.slice(0, 47)}…` : t;
    }
    this.save(c);
  }
}
