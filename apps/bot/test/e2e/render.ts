// The two renderings of a finished e2e run (spec 023 FR-542, FR-543): the readable text transcript of what the channel
// would show, and a local HTML file that draws every message with its embed (colour bar, title, description, fields,
// footer) and its buttons, in a generic dark chat style — no logos, no branding of any real chat product.
import type { ButtonSpec, EmbedSpec, OutMessage } from '../../src/core/model';
import { PLAYERS } from './plan';
import type { MatchRun, RunEntry } from './script';

const NAME_OF = new Map(PLAYERS.map((p) => [p.userId, p.displayName] as const));
const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

const buttonLine = (b: ButtonSpec): string =>
  b.type === 'link' ? `«${b.label}» → ${b.url}` : `«${b.label}»${b.disabled === true ? ' (desactivado)' : ''}${b.style === 'success' ? ' (verde)' : ''}`;

const embedLines = (embed: EmbedSpec): string[] => {
  const out = [`   [embed «${embed.title}» · ${hex(embed.color)}]`];
  if (embed.description !== undefined) out.push(`      ${embed.description}`);
  for (const f of embed.fields) out.push(`      ${f.name}: ${f.value}`);
  if (embed.footer !== undefined) out.push(`      — ${embed.footer} —`);
  return out;
};

const messageLines = (prefix: string, message: OutMessage): string[] => [
  `${prefix} ${message.text}`,
  ...(message.embed === undefined ? [] : embedLines(message.embed)),
  ...(message.buttons.length === 0 ? [] : [`   [botones] ${message.buttons.map(buttonLine).join(' · ')}`]),
];

const replyLines = (entry: Extract<RunEntry, { kind: 'reply' }>): string[] => {
  const r = entry.reply;
  if (r.type === 'text') return [`[solo ${entry.to}] ${r.text}`];
  if (r.type === 'select') return [`[solo ${entry.to}] ${r.text} (menú: ${r.options.map((o) => o.label).join(', ')})`];
  if (r.type === 'channel') return r.messages.flatMap((m) => messageLines(`[canal]`, m));
  if (r.type === 'modal') return [`[solo ${entry.to}] ${r.title}: ${r.label}`];
  return [`[solo ${entry.to}] (sugerencias: ${r.choices.map((c) => c.name).join(', ')})`];
};

/** The whole run as text: a stage header per stage, then each post, edit and private reply in order. */
export function renderTranscript(run: MatchRun): string {
  const lines: string[] = [
    'FactionFall e2e — un partido completo contra el servidor real (Discord simulado)',
    `Partida ${run.matchId} · mapa ${run.mapId} · jugadoras: ${PLAYERS.map((p) => p.displayName).join(', ')}`,
    `Visor: ${run.viewerMatchUrl}`,
    '',
  ];
  let stage = '';
  for (const entry of run.entries) {
    if (entry.stage !== stage) {
      stage = entry.stage;
      lines.push(`— ${stage} —`);
    }
    if (entry.kind === 'post') lines.push(...messageLines('[canal]', entry.message));
    else if (entry.kind === 'reply') lines.push(...replyLines(entry));
    else lines.push(`[edición] mensaje ${entry.messageId}: botones → ${entry.message.buttons.map(buttonLine).join(' · ')}`);
  }
  if (run.violations.length > 0) lines.push('', 'VIOLACIONES DE SECRETO:', ...run.violations.map((v) => `  ${v}`));
  return lines.join('\n');
}

// --- HTML ---

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Message text as HTML: escapes, **bold**, mentions as @Name pills, line breaks. */
function textHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/&lt;@(\d+)&gt;/g, (_all, id: string) => `<span class="mention">@${escapeHtml(NAME_OF.get(id) ?? id)}</span>`)
    .replace(/\n/g, '<br>');
}

const embedHtml = (embed: EmbedSpec): string => `
    <div class="embed" style="border-left-color:${hex(embed.color)}">
      <div class="e-title">${textHtml(embed.title)}</div>
      ${embed.description === undefined ? '' : `<div class="e-desc">${textHtml(embed.description)}</div>`}
      ${embed.fields.length === 0 ? '' : `<div class="e-fields">${embed.fields
        .map((f) => `<div class="e-field"><div class="e-name">${textHtml(f.name)}</div><div class="e-value">${textHtml(f.value)}</div></div>`)
        .join('')}</div>`}
      ${embed.footer === undefined ? '' : `<div class="e-footer">${textHtml(embed.footer)}</div>`}
    </div>`;

const buttonsHtml = (buttons: readonly ButtonSpec[]): string =>
  buttons.length === 0
    ? ''
    : `<div class="buttons">${buttons
        .map((b) =>
          b.type === 'link'
            ? `<a class="btn link" href="${escapeHtml(b.url)}" title="${escapeHtml(b.url)}">${escapeHtml(b.label)}</a>`
            : `<span class="btn ${b.style}${b.disabled === true ? ' off' : ''}">${escapeHtml(b.label)}</span>`,
        )
        .join('')}</div>`;

const STYLE = `
  body { margin: 0; background: #17181b; font: 15px/1.45 system-ui, 'Segoe UI', sans-serif; color: #d6d9dc; }
  .channel { max-width: 760px; margin: 24px auto; background: #212226; border-radius: 10px; overflow: hidden; }
  .head { padding: 14px 18px; border-bottom: 1px solid #2f3136; background: #26272c; }
  .head .title { font-weight: 600; color: #e6e8ea; }
  .head .sub { font-size: 12.5px; color: #949ba4; margin-top: 3px; }
  .head .sub a { color: #7ea3d8; text-decoration: none; }
  .stage { text-align: center; color: #949ba4; font-size: 12px; margin: 14px 18px 6px; }
  .msg { display: flex; gap: 12px; padding: 6px 18px; }
  .msg:hover { background: #26272c; }
  .avatar { flex: none; width: 38px; height: 38px; border-radius: 50%; background: #5a67d8; color: #fff; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .content { min-width: 0; flex: 1; }
  .who { margin-bottom: 2px; }
  .who .name { font-weight: 600; color: #e6e8ea; }
  .who .tag { font-size: 10.5px; font-weight: 700; color: #7ea3d8; background: rgba(126, 163, 216, .18); border-radius: 4px; padding: 1px 4px; margin-left: 6px; vertical-align: 1px; }
  .text { white-space: normal; word-wrap: break-word; }
  .mention { background: rgba(90, 103, 216, .3); color: #c3c9f5; border-radius: 4px; padding: 0 3px; }
  .embed { background: #2b2d31; border-left: 4px solid #5865f2; border-radius: 6px; padding: 10px 14px; margin: 6px 0 2px; max-width: 520px; }
  .e-title { font-weight: 600; color: #e6e8ea; margin-bottom: 4px; }
  .e-desc { color: #c8ccd0; }
  .e-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin-top: 8px; }
  .e-field { min-width: 0; }
  .e-name { font-size: 12px; font-weight: 600; color: #b6bac0; margin-bottom: 1px; }
  .e-value { color: #d6d9dc; }
  .e-footer { font-size: 12px; color: #949ba4; margin-top: 10px; }
  .buttons { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 4px; }
  .buttons.final { margin: 0 0 4px; }
  .buttons.final .btn { opacity: .8; }
  .btn { display: inline-block; padding: 6px 14px; border-radius: 8px; font-size: 13.5px; font-weight: 500; }
  .btn.primary { background: #5a67d8; color: #fff; }
  .btn.success { background: #3ea55d; color: #fff; }
  .btn.link { background: #4e5058; color: #d6d9dc; text-decoration: none; }
  .btn.off { opacity: .45; }
  .edited { font-size: 11.5px; color: #949ba4; margin-top: 2px; }
`;

/** Every message of the run as a local HTML page: the chat-like column with each embed and its buttons (FR-543). */
export function renderEmbedsHtml(run: MatchRun): string {
  // The buttons a message ended with: the last edit of a message replaces what it was posted with. The preview shows the
  // posted state first, then the edited one (a countdown label that became the closed, disabled button).
  const finalButtons = new Map<string, readonly ButtonSpec[]>();
  for (const entry of run.entries) if (entry.kind === 'edit') finalButtons.set(entry.messageId, entry.message.buttons);

  const body: string[] = [];
  let stage = '';
  for (const entry of run.entries) {
    if (entry.kind === 'reply') continue;
    if (entry.stage !== stage) {
      stage = entry.stage;
      body.push(`<div class="stage">— ${escapeHtml(stage)} —</div>`);
    }
    if (entry.kind === 'edit') continue;
    const editedButtons = finalButtons.get(entry.messageId);
    body.push(`
  <div class="msg">
    <div class="avatar">FF</div>
    <div class="content">
      <div class="who"><span class="name">FactionFall</span><span class="tag">bot</span></div>
      <div class="text">${textHtml(entry.message.text)}</div>
      ${entry.message.embed === undefined ? '' : embedHtml(entry.message.embed)}
      ${buttonsHtml(entry.message.buttons)}
      ${editedButtons === undefined ? '' : `<div class="buttons final">${buttonsHtml(editedButtons)}</div>\n      <div class="edited">editado: el botón Predecir se desactivó al cerrarse la fase</div>`}
    </div>
  </div>`);
  }

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FactionFall e2e — ${escapeHtml(run.matchId)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="channel">
  <div class="head">
    <div class="title"># partidas — vista previa</div>
    <div class="sub">partida ${escapeHtml(run.matchId)} · mapa ${escapeHtml(run.mapId)} · visor: <a href="${escapeHtml(run.viewerMatchUrl)}">${escapeHtml(run.viewerMatchUrl)}</a></div>
  </div>
${body.join('\n')}
  <div style="height: 18px"></div>
</div>
</body>
</html>
`;
}
