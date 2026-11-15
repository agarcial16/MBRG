// The page entry (FR-306): the match door (join, lobby or the live scene, spec 013) for a match address; the debug scene only in development builds. In a production
// build `import.meta.env.DEV` is the constant false, so the bundler drops the debug import, the sim and the dev map assets.
import { enter } from './enter';
import { showStart } from './live-start';
import { showMessage } from './message';
import { startMatchEntry } from './play-main';

void enter(window.location.search, import.meta.env.DEV, {
  debug: import.meta.env.DEV ? () => import('./main') : undefined,
  live: startMatchEntry,
  start: showStart,
  message: showMessage,
});
