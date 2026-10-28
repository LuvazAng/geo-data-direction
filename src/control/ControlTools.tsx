import { useState } from 'react';
import { DefinitionList, Drawer, ToolGroup, ToolRow } from '@ui';
import { api } from './api';
import { GLOSSARY } from './glossary';
import { controlToolStates } from './tools';
import type { Centro } from './useCentro';

type View = 'herramientas' | 'glosario';

const VIEWS: Record<View, { title: string; description: string }> = {
  herramientas: {
    title: 'Herramientas',
    description: 'Las acciones del centro de control, siempre a la mano. Lo que no aplica ahora se ve apagado y dice por qué.',
  },
  glosario: { title: 'Glosario', description: 'Qué significan los términos que aparecen en el centro de control.' },
};

/** El cajón de herramientas del centro: pausar la cola, mantener los lotes al día, el chat y la ayuda. */
export function ControlTools({ centro, online, onClose }: { centro: Centro; online: boolean; onClose: () => void }) {
  const { state, call, act, busy, newConversation } = centro;
  const [view, setView] = useState<View>('herramientas');
  const { title, description } = VIEWS[view];
  const paused = state.cola.pausada;
  const routes = Object.fromEntries(state.lotes.map((l) => [l.lote, state.rutas.filter((u) => u.lote === l.lote).length]));
  const s = controlToolStates({ online, busy, paused, pending: state.cola.orden.length }, routes);
  // al usar una herramienta se cierra el cajón para ver su efecto
  const run = (fn: () => unknown) => () => {
    void fn();
    onClose();
  };

  return (
    <Drawer title={title} description={description} onClose={() => (view === 'herramientas' ? onClose() : setView('herramientas'))}>
      {view === 'herramientas' ? (
        <>
          <ToolGroup title="Cola" description="Qué se ejecuta y cuándo.">
            <ToolRow
              icon={paused ? 'play' : 'pause'}
              label={paused ? 'Reanudar la cola' : 'Pausar la cola'}
              description={
                paused
                  ? 'La cola está en pausa: sólo se ejecuta lo que pidas a mano. Al reanudarla toma la siguiente cuando termine la ejecución actual.'
                  : 'No se toman ejecuciones nuevas; la que está en curso termina normalmente.'
              }
              state={s.pause}
              onRun={run(() => call(paused ? api.resume : api.pause))}
            />
            <ToolRow
              icon="chevron-right"
              label="Procesar la siguiente"
              description="Toma ya la primera ejecución de la cola, aunque la cola esté en pausa."
              state={s.runNext}
              onRun={run(() => act({ tipo: 'ejecutar-siguiente' }))}
            />
          </ToolGroup>

          <ToolGroup title="Lotes" description="Mantén al día las rutas de cada zona.">
            {state.lotes.flatMap((l) => [
              <ToolRow
                key={`fuente-${l.lote}`}
                icon="refresh"
                label={`Actualizar la fuente de ${l.lote}`}
                description="Lee de nuevo la página de la zona y sus subpáginas. No descarga mapas."
                state={s.updateSource[l.lote]}
                onRun={run(() => act({ tipo: 'actualizar-fuente', lote: l.lote }))}
              />,
              <ToolRow
                key={`pendientes-${l.lote}`}
                icon="queue"
                label={`Encolar las pendientes de ${l.lote}`}
                description="Agrega a la cola las rutas que están sin procesar o a medias y no tienen una ejecución en curso."
                state={s.enqueuePending[l.lote]}
                onRun={run(() => act({ tipo: 'encolar-pendientes', lote: l.lote }))}
              />,
            ])}
          </ToolGroup>

          <ToolGroup title="Chat" description="La conversación con el centro y con Qwen.">
            <ToolRow
              icon="chat"
              label="Nuevo chat"
              description="Empieza una conversación sin historial: Qwen no relee los mensajes anteriores."
              state={s.newChat}
              onRun={run(() => newConversation())}
            />
          </ToolGroup>

          <ToolGroup title="Ayuda" description="Para no perderte en el centro de control.">
            <ToolRow
              icon="book"
              label="Glosario"
              description="Qué significan «lote», «ruta», «ejecución», «revisión» y los demás términos."
              onRun={() => setView('glosario')}
            />
          </ToolGroup>
        </>
      ) : (
        <DefinitionList narrow entries={Object.values(GLOSSARY).map(({ term, definition }) => ({ term, definition }))} />
      )}
    </Drawer>
  );
}
