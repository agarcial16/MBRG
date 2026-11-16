# Spec 019 — Viewer leaderboard at scale
Status: approved by the user on 2026-11-16
Tier: Light SDD (UI only; one page). Amends spec 013 FR-406 (leaderboard in the right column) without changing its secrecy rules (FR-449).

## Context and goal
The right-hand "Clasificación" panel lists the match's players by points. Matches may now hold hundreds or thousands of players, and the panel was written for dozens. Goal: the panel stays usable with up to 1,000 players (target) and does not break at 10,000, and a viewer can find their own place and any player by name.

What the panel does today (read from the code; counts at 1,000 and 10,000 are derived from it, NOT measured):
- Fetch: after a phase is scored (and once at start) the viewer reads the WHOLE leaderboard, following the server cursor in pages of 500 until none is left, and the whole roster the same way (once). 20 players: 1 request; 200: 1; 1,000: 2; 10,000: 20 (plus 20 for the roster). Each scored phase repeats it.
- Merge: all rows are held in memory; players with no score are added with 0 points; the full list is sorted and ranked on every refresh (competition ranking; ties share a rank; the server order is kept within a tie, newcomers after).
- Draw: client-side pages of 10 rows (so 10 rows in the DOM at any size), with previous/next and "page / pages"; no jump to a page, no search (the search box in the left column filters factions, not players).
- Own place: the viewer's row is highlighted when on the shown page; otherwise it is pinned under the list. There is no way to go to the page that holds it.
- Refresh: the column is rebuilt only when the shown page content changes (signature), so the per-second HUD refresh does not rebuild it. Changing page rebuilds the whole column, so the focus on the pager button is lost.
- Secrecy: during a victim reveal, an absorber tour or the finalised beat the panel keeps what it showed before the tour (013 FR-449).
- Not verified: behaviour of a spectator without a player session; the cost (time, memory, requests, bytes) at 1,000 and 10,000 players; the layout at 360 px with long names.

Measurement plan (first task of the implementer, before changing anything): with a fake server serving N = 20, 200, 1,000 and 10,000 synthetic players, record per N: requests and bytes per refresh, time to merge/sort/rank, time to paint a page, DOM node count of the panel, and a note on scrolling and paging. Results go to `PROGRESS.md` and decide the figures of NFR-105.

## Users
Spectators (no account) and players of the match, on desktop and on a 360 px phone.

## User stories
- US-1. As a viewer of a large match, I want the panel to stay quick and readable so that I can follow the ranking.
- US-2. As a player, I want my row marked and a shortcut to it so that I find my place at once.
- US-3. As a viewer, I want to search a player by name so that I can see their place.

## Functional requirements
- FR-507: THE SYSTEM SHALL keep the leaderboard usable with up to 1,000 players: first rows visible without loading every page, and the viewer can reach any rank.
- FR-508: THE SYSTEM SHALL fetch the leaderboard in pages with the server `limit` and `cursor`, and SHALL draw only the rows in or near the visible window of the panel (windowed rendering), never the full list.
- FR-509: WHILE rows beyond the loaded ones are needed (scrolling, jump to my place, search), THE SYSTEM SHALL fetch the next pages by cursor on demand and show a loading row for them; a refused or failed page SHALL show a retry control and keep the rows already shown.
- FR-510: WHEN a new phase is scored, THE SYSTEM SHALL refresh the loaded window from the first page; IF the server answers `stale-cursor`, THEN THE SYSTEM SHALL restart from the first page and keep the scroll position as near as the new order allows.
- FR-511: THE SYSTEM SHALL mark the viewer's own row (existing "(tú)" mark and highlight) and, WHILE the viewer is a player of the match, SHALL offer a "go to my place" control that scrolls to that row, loading pages as FR-509 says, and moves the focus to it.
- FR-512: WHILE the viewer's row is outside the window, THE SYSTEM SHALL keep it visible, pinned at the edge of the panel, with its rank and points.
- FR-513: WHEN the viewer types in the search box of the panel, THE SYSTEM SHALL list the players whose name contains the text, ignoring case and accents, with their rank. The search runs over the rows loaded so far and, when the list is not fully loaded, loads the remaining pages in order (up to the cap of NFR-106), saying "buscando..." and how many rows were searched; it does not call any server search.
- FR-514: THE SYSTEM SHALL keep the order the server gives (rank, then id) and the competition ranking with shared ranks for ties; rows with the same points show the same rank and never reorder between refreshes unless a score changes. Players the server lists with no score keep the rule of 013 FR-432 (0 points, after the scored ones).
- FR-515: THE SYSTEM SHALL show each player's name as the server gives it, or its local id when the server gave none; it SHALL NOT resolve Discord names.
- FR-516: THE SYSTEM SHALL show nothing about unscored phases or future rounds, and WHILE a reveal, absorber tour or finalised beat runs SHALL keep the rows shown before it (013 FR-449); it SHALL show a tour's scores only once the tour ends.
- FR-517: THE SYSTEM SHALL take every visible text of the panel (title, search, go-to-my-place, loading, retry, empty, searching, no-match) from the strings module (Spanish).
- FR-518: THE SYSTEM SHALL let the whole panel be used by keyboard: the list scrolls with the arrow, page and home/end keys, the search box and the shortcut are reachable by Tab, and the rows have an accessible text with rank, name and points.

## Non-functional requirements
- NFR-105: THE SYSTEM SHALL keep the DOM of the panel at no more than 60 rows at any list size, and the per-second HUD refresh SHALL not rebuild or move any row. Figures for time (paint of a window, merge of N rows) are set from the measurement plan and checked at N = 1,000 and N = 10,000 (no frame over the budget fixed there).
- NFR-106: THE SYSTEM SHALL not load more than 20 pages (limit 500) for one search; beyond that it says the search covers the first rows only.
- NFR-107: WHEN the list refreshes (scored phase, per-second tick), THE SYSTEM SHALL keep the keyboard focus on the same element and the same scroll position.
- NFR-108: THE SYSTEM SHALL lay out at 360 px width with no horizontal scroll, touch targets of at least 44 px, long names cut with an ellipsis and a full-name tooltip or accessible label.

## Edge cases
- 0 scored players: "Todavía no hay puntos." as today; search over the roster still works.
- Viewer without a player session: no "go to my place", no pinned row; search and scrolling work.
- Viewer is a player with no score yet: pinned row with "-" as rank (as today).
- Page fetch fails mid-scroll or the viewer is rate-limited: keep the rows, show retry; no request loop.
- Search text with no match, or only spaces: "sin resultados" / the full list.
- Ties spanning page borders: same rank on both pages, order stable.
- Match with 10,000 players: opens by loading one page only; search and jump read at most NFR-106 pages.
- The list changes between pages (a phase scored): `stale-cursor` handling per FR-510.
- Window resize or phone dock fold/unfold: window recomputed, scroll position kept.

## Out of scope
- Server or protocol changes (including a server-side search or a rank lookup by player).
- Discord names and the bot.
- New columns (correct counts per kind), sorting by anything but points, and the factions list.
- Changes to what is scored or when it is revealed.

## Done criteria
- Measurement of today's behaviour at N = 20, 200, 1,000, 10,000 recorded in `PROGRESS.md`, and after the change the same table at 1,000 and 10,000 meets NFR-105.
- Tests (Vitest) for the pure parts: windowing, paging by cursor with `stale-cursor`, search with accents, ranking with ties, secrecy during a tour.
- Reviewed screenshots of the debug scene (fixed seed and round) at 1,000 players on desktop and at 360 px: top, middle, own place, search result.
- Keyboard pass: focus kept across a refresh and a page load.
- `npm test` and `npm run typecheck` green; no change under server or protocol.

## Decisions (user, 2026-11-16)
- "Go to my place" may load as many pages as needed up to the cap of NFR-106 (20 pages), with a loading row and a way to cancel.
- The search covers every player of the match, scored or not (the roster too).
- A spectator without a player session sees the leaderboard; the measurement checks it and, if today it does not, the spec fixes it.
