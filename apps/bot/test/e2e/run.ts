// The `npm run e2e` command (spec 023 FR-542, FR-543): plays the scripted match of the plan against the real server and the
// real bot core — the same harness and the same script as the test of `npm test` — then prints what the channel would show
// (messages, embeds as text, buttons) with the viewer link of the match, and writes the embed preview as a local HTML file.
// Exit code 1 when the run found a secrecy violation.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderEmbedsHtml, renderTranscript } from './render';
import { playScriptedMatch } from './script';
import { startWorld } from './world';

async function main(): Promise<void> {
  const world = await startWorld();
  try {
    const run = await playScriptedMatch(world);
    const transcript = renderTranscript(run);
    const html = renderEmbedsHtml(run);
    // The output folder of the repo, whatever the working directory the command ran from.
    const outDir = fileURLToPath(new URL('../../../../e2e-preview/', import.meta.url));
    mkdirSync(outDir, { recursive: true });
    const transcriptPath = `${outDir}transcript.txt`;
    const htmlPath = `${outDir}embeds.html`;
    writeFileSync(transcriptPath, `${transcript}\n`, 'utf8');
    writeFileSync(htmlPath, html, 'utf8');
    console.log(transcript);
    console.log('');
    console.log(`Visor de la partida: ${run.viewerMatchUrl}`);
    console.log(`Transcripción:        ${transcriptPath}`);
    console.log(`Vista previa (HTML):  ${htmlPath}`);
    if (run.violations.length > 0) {
      console.error('');
      console.error('VIOLACIONES DE SECRETO:');
      for (const violation of run.violations) console.error(`  ${violation}`);
      process.exitCode = 1;
    }
  } finally {
    await world.close();
  }
}

await main();
