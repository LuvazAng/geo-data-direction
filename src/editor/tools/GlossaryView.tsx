import { DefinitionList } from '@ui';
import { GLOSSARY } from './glossary';

/** Los términos propios del editor, explicados. */
export function GlossaryView() {
  return <DefinitionList narrow entries={Object.values(GLOSSARY).map(({ term, definition }) => ({ term, definition }))} />;
}
