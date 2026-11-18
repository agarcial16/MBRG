# Spec 020 progress

## Implementation (Light SDD, one pass)
Changed (apps/web only): `core/play-entry.ts` (`entryScreen(stage, hasPlayer, clientOnly)`, new screens `lobby-wait`, `spectate`), `core/play-forms.ts` (`joins-closed` sentence), `core/predict-model.ts` (`spectatorSentence`, `offerText` third param), `core/play-view.ts` and `ui/play-session.ts` (`clientOnly` plumbed from `match.clientOnly` in `ui/live-main.ts`), `ui/play-lobby.ts` (`showClientOnlyWait`: plain sentence, event stream and retry as the lobby, no player), `ui/play-main.ts` (switch), `core/strings.ts` (`joinClosedDiscord`, `clientOnlyLobbyText`, `predictNoneClientOnly`).
Tests first (red, then green): `play-entry`, `play-forms`, `predict-model`, `play-session` tests (FR-519..524).
Decisions: a client-only ended match opens "watch" with no player; `noOfferText` untouched (it is used with `.map`); the join screen already offers "Solo mirar" so FR-523 needed only the sentence.

## Tests
Web tests of the area: 138 passed. Full `npm test`: only `apps/web/test/package.test.ts` (FR-132) fails, and it fails identically without my changes (checked with git stash; the repo path has spaces and `/@fs/` URLs). `npm run typecheck`: green.

## Untested
The real-browser hand run (Discord-created match: running as spectator, lobby wait that enters the scene on Start; open match keeps the join screen). `showClientOnlyWait` has no DOM test (shell, like the lobby).

## Next
User hand run, reviewer, PR.
