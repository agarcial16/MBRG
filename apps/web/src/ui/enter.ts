// The page entry decision (FR-306): which scene the address asks for and what runs. Pure of the page: the actions are
// injected, `dev` is the build kind. `debug` is present in development builds only, so a production page can neither
// reach the debug scene nor ask for it (it shows the need-match message instead).
import { chooseScene } from '../core/live-address';
import { errorText } from '../core/live-text';

export interface EnterActions {
  readonly debug: (() => Promise<unknown>) | undefined;
  live(matchId: string): void;
  message(text: string): void;
}

export async function enter(search: string, dev: boolean, actions: EnterActions): Promise<void> {
  const choice = chooseScene(search, dev);
  if (choice.kind === 'live') return actions.live(choice.matchId);
  if (choice.kind === 'debug') {
    if (actions.debug !== undefined) await actions.debug();
    else actions.message(errorText('need-match'));
    return;
  }
  actions.message(errorText(choice.error));
}
