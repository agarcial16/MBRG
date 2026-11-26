// The page entry decision (FR-306): which scene the address asks for and what runs. Pure of the page: the actions are
// injected, `dev` is the build kind. `debug` is present in development builds only, so a production page can neither
// reach the debug scene nor ask for it (it shows the need-match message instead).
import type { CaptureRequest } from '../core/capture';
import { chooseScene } from '../core/live-address';
import { errorText } from '../core/live-text';

export interface EnterActions {
  readonly debug: (() => Promise<unknown>) | undefined;
  /** `spectate` is true for a spectator link (`spectate=1`): the scene opens with no door and no player (FR-470). */
  live(matchId: string, spectate?: boolean): void;
  /** The start screen of the single entry page. */
  start(): void;
  message(text: string): void;
  /** Spec 038: the bot's screenshot mode; no request: the address is not a valid capture address. */
  capture(request: CaptureRequest | undefined): void;
}

export async function enter(search: string, dev: boolean, actions: EnterActions): Promise<void> {
  const choice = chooseScene(search, dev);
  if (choice.kind === 'capture') return actions.capture(choice.request);
  if (choice.kind === 'live') return actions.live(choice.matchId, choice.spectate === true);
  if (choice.kind === 'start') return actions.start();
  if (choice.kind === 'debug') {
    if (actions.debug !== undefined) await actions.debug();
    else actions.message(errorText('need-match'));
    return;
  }
  actions.message(errorText(choice.error));
}
