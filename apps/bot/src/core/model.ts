// The plain shapes the pure core and the shells share (spec 012 NFR-90). No Discord library types here.

export type ButtonSpec =
  | { readonly type: 'custom'; readonly customId: string; readonly label: string; readonly style: 'primary' | 'success' }
  | { readonly type: 'link'; readonly url: string; readonly label: string };

/** One message for the channel: its text and at most a few buttons (never one per candidate). Mentions are written in the text. */
export interface OutMessage {
  readonly text: string;
  readonly buttons: readonly ButtonSpec[];
}

export interface SelectOption {
  readonly label: string;
  readonly value: string;
}

/** What an interaction is answered with. `text`, `select` and `modal` are seen only by the member; `channel` is public. */
export type Reply =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'channel'; readonly messages: readonly OutMessage[] }
  | { readonly type: 'select'; readonly text: string; readonly customId: string; readonly placeholder: string; readonly options: readonly SelectOption[] }
  | { readonly type: 'modal'; readonly customId: string; readonly title: string; readonly label: string }
  | { readonly type: 'suggest'; readonly choices: readonly { readonly name: string; readonly value: string }[] };

export type PhaseKind = 'victim' | 'absorber';
export type Pace = 'fast' | 'normal' | 'slow';
