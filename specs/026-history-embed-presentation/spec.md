# Spec 026 — History embed presentation pass
Status: approved (the user approved the mockup on 2026-11-20 and ordered this session)
Tier: Light SDD (presentation only, inside the wording of 024 FR-554). Outside the traceability ledger, like the old specs 012/013: no FR ids are added anywhere, `packages/sim/test/traceability.test.ts` is not touched.

## Goal
The history embed of 024 FR-554 works but reads like a leaderboard: the top 5 as five separate lines, the viewer link on a line of its own, no ordinal to tell the matches apart. The approved mockup (`C:/Users/agarc/.mbrg/mockup/history-embed.png`) compacts each entry. This pass changes only what the bot shows: the same data, the same paging, the same privacy and the same limits, inside the current FR-554 wording.

## The three approved changes
1. **The top on one line.** The top 5 compact onto one line: `🥇 <@a> 12 · 🥈 <@b> 9 · 🥉 <@c> 7 · 4. <@d> 5 · 5. <@e> 3` — medals for the first three rows, their position number for the rest, one ` · ` between cells, and ` · y N más` at the end of the same line when rows above 0 points were left out. The podium is positional (the first three rows in leaderboard order): the server's rank stays in the asker's "puesto R", and equal points keep ties visible. Nobody scored: the whole line is the existing "Nadie sumó puntos". Fitting five mentions on one line is Discord's business (embeds stretch to the client width; narrow clients wrap): nothing is shortened for width.
2. **The viewer link merged into the asker's line.** `Tus puntos: 3 (puesto 1) · [Ver en el visor](URL)` in the embed and `Tus puntos: 3 (puesto 1) · URL` in the plain-text fallback; "No jugaste esta partida" carries it the same way. An entry with no asker keeps its own link line as today (last line). No configured viewer: no link anywhere, the asker's line stays plain.
3. **The ordinal in the field name.** `#N · <t:SECONDS:d> · mapa`, with N computed in the bot from the walk's snapshot total and the page offset: N = total − (page − 1) × 5 − indexInPage, newest first, the page clamped exactly as the footer's. The winner line keeps its bold winner with the player count at normal weight beside it (`Ganó **Italia** · N jugadores`, in the embed and in the fallback — already the shape FR-554 pins; kept as is).

## Out of scope
No server, protocol or paging change; no new commands; the page size stays 5; no map-name or `ctx.mapName` change; nothing outside `apps/bot` presentation.

## Done criteria
- Tests updated first for every pinned line that changes by design; each changed pin listed in `PROGRESS.md` with its reason.
- The worst case (5 entries, 24-character names, top 5 full, "y N más", the asker line and the link) stays within every 017 NFR-94 limit: 6,000 characters in all, at most 25 fields, description at most 4,096 and every field value at most 1,024; the compact line makes the field value smaller and the test proves it.
- The plain-text fallback carries the same information, with the bare address in place of the markdown link.
- Mentions never ping (`allowedMentions` parse []); every string in `core/strings.ts`, Spanish.
- Mutation proofs: ordinal off by one, medals miscounted, link dropped from the asker line — each kills a test.
- `npm test` and `npm run typecheck` green; protected paths byte-identical vs `origin/main`.
