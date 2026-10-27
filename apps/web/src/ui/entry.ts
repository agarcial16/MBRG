// The page entry (FR-306): the live scene for a match address; the debug scene only in development builds. In a production
// build `import.meta.env.DEV` is the constant false, so the bundler drops the debug import, the sim and the dev map assets.
import { enter } from './enter';
import { startLiveScene } from './live-main';
import { showStart } from './live-start';
import { showMessage } from './message';

void enter(window.location.search, import.meta.env.DEV, {
  debug: import.meta.env.DEV ? () => import('./main') : undefined,
  live: startLiveScene,
  start: showStart,
  message: showMessage,
});
