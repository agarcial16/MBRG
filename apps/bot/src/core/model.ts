// The plain shapes the pure core and the shells share (spec 012 NFR-90). No Discord library types here.
import type { HistoryPage, RankingOrder, RankingPage } from '@mbrg/protocol';

export type ButtonSpec =
  | { readonly type: 'custom'; readonly customId: string; readonly label: string; readonly style: 'primary' | 'success'; readonly disabled?: boolean }
  | { readonly type: 'link'; readonly url: string; readonly label: string };

export interface EmbedField {
  readonly name: string;
  readonly value: string;
}

/** A Discord embed as plain data (spec 017 FR-472). No image of any kind: there is no image field here. */
export interface EmbedSpec {
  readonly color: number;
  readonly title: string;
  readonly description?: string;
  readonly fields: readonly EmbedField[];
  readonly footer?: string;
}

/** What the shell registers for a leaderboard message it posted: its match and, for a public board, who asked (none: the final post). */
export interface BoardTag {
  readonly matchId: string;
  readonly askerId?: string;
}

/**
 * What the shell remembers of a history message it posted (spec 024 FR-555): who asked, the community key and the pages shown so far.
 * The first page has no cursor, so the pages themselves are kept (each holds its own cursor to the next): going back shows the same snapshot.
 */
export interface HistoryTag {
  readonly askerId: string;
  readonly community: string;
  readonly pages: readonly HistoryPage[];
}

/**
 * What the shell remembers of a ranking message it posted (spec 025 FR-569, as the history's): who asked, the community key, the order and the
 * pages shown so far, each holding its own cursor to the next. Going back shows the same snapshot.
 */
export interface RankingTag {
  readonly askerId: string;
  readonly community: string;
  readonly order: RankingOrder;
  readonly pages: readonly RankingPage[];
}

/**
 * One message for the channel: its text and at most a few buttons (never one per candidate). Mentions are written in the text.
 * `embed` is what is shown when the bot may embed; `text` is always the plain version of 012, the fallback without Embed Links (FR-475).
 */
export interface OutMessage {
  readonly text: string;
  readonly buttons: readonly ButtonSpec[];
  readonly embed?: EmbedSpec;
  /** Set on a leaderboard message whose buttons page it: the shell registers it by message id (FR-480, FR-481). */
  readonly board?: BoardTag;
  /** Set on a history message whose buttons page it: the shell registers it by message id (FR-555). */
  readonly history?: HistoryTag;
  /** Set on a ranking message whose buttons page it: the shell registers it by message id (spec 025 FR-569). */
  readonly ranking?: RankingTag;
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
