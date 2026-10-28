import { useState } from 'react';
import { Drawer, ToolGroup, ToolRow } from '@ui';
import { GlossaryView } from './GlossaryView';
import { ShortcutsHelp } from './ShortcutsHelp';
import { GROUPS, type ToolDef } from './tools';

type View = 'herramientas' | 'atajos' | 'glosario';

const VIEWS: Record<View, { title: string; description: string }> = {
  herramientas: {
    title: 'Herramientas',
    description: 'Todo lo que puede hacer el editor, siempre a la mano. Lo que no aplica ahora se ve apagado y dice por qué.',
  },
  atajos: { title: 'Atajos de teclado', description: 'Para revisar más rápido sin soltar el mapa.' },
  glosario: { title: 'Glosario', description: 'Qué significan los términos que aparecen en el editor.' },
};

/** El cajón de herramientas: todas las funciones del editor agrupadas, con su estado y la ayuda. */
export function ToolsDrawer({ tools, initialView, onClose }: { tools: ToolDef[]; initialView: View; onClose: () => void }) {
  const [view, setView] = useState<View>(initialView);
  const { title, description } = VIEWS[view];
  return (
    <Drawer title={title} description={description} onClose={() => (view === initialView ? onClose() : setView('herramientas'))}>
      {view === 'herramientas' && (
        <>
          {GROUPS.map((g) => (
            <ToolGroup key={g.id} title={g.title} description={g.description}>
              {tools
                .filter((t) => t.group === g.id)
                .map((t) => (
                  <ToolRow
                    key={t.id}
                    icon={t.icon}
                    label={t.label}
                    description={t.description}
                    shortcut={t.shortcut}
                    state={t.state}
                    control={t.control}
                    onRun={
                      t.run &&
                      (() => {
                        t.run!();
                        if (!t.keepOpen) onClose();
                      })
                    }
                  />
                ))}
            </ToolGroup>
          ))}
          <ToolGroup title="Ayuda" description="Para no perderte en el editor.">
            <ToolRow icon="keyboard" label="Atajos de teclado" description="Las teclas que aceleran la revisión." onRun={() => setView('atajos')} />
            <ToolRow
              icon="book"
              label="Glosario"
              description="Qué significan «dupla», «tramo corto», «vértice» y los demás términos."
              onRun={() => setView('glosario')}
            />
          </ToolGroup>
        </>
      )}
      {view === 'atajos' && <ShortcutsHelp />}
      {view === 'glosario' && <GlossaryView />}
    </Drawer>
  );
}
