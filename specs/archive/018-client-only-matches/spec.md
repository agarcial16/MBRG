# Spec 018 — Client-only matches
Status: implemented (approved 2026-11-15; hand-tested 2026-11-16; merged in #66). Tier: Full SDD (touches the server, the protocol, persistence and the secrecy review). Depends on 008, 011, 012, 014 and 016 (implemented). Ids: FR-490 onwards, NFR-100 onwards (FR-480..484 and NFR-92..94 belong to spec 017).

## Context and goal
A match the Discord bot creates goes through public creation (011 FR-369), so it is open: anyone who opens the web viewer on it meets the name door and can join as a named `player:`, then predict beside the Discord members. The community that created the match wants it to stay theirs. This spec adds a per-match join policy chosen once at creation: a match created through a client credential may be marked **client-only**, so only that client's players can predict in it, while everybody can still watch it (every public read and the event stream stay public). The default stays open, so old matches, old clients and the web flow behave exactly as before.

## Users
- Client operator (the Discord bot): creates matches whose players come only from its community.
- Web visitor: watches any match; joins only open ones.
- Server operator: configures client credentials; runs the server.

## User stories
- US-1. As the bot, I want to create a match only my members can predict in, so that outsiders cannot join it from the viewer.
- US-2. As a web visitor opening a client-only match, I want to go straight to watching, so that I am not asked for a name I cannot use.
- US-3. As a server operator, I want old matches and clients to keep working unchanged, so that the change needs no data repair.

## Definitions
- **Join policy**: `open` (011 behaviour) or `client` (client-only). Chosen at creation, never changed.
- **Owning namespace**: for a client-only match, the namespace of the client credential that created it (008 FR-284). It is stored with the match and never published.
- **Restricted callers** of a client-only match: every caller except a client credential of the owning namespace.

## Functional requirements
**Creation**
- FR-490: THE SYSTEM SHALL accept an optional member `joinPolicy` in the creation request, with the values `open` and `client`; its absence means `open`, and any other value, type or duplicate is `invalid-request` naming `joinPolicy`. A creation without the member keeps the 011 behaviour and reply byte for byte.
- FR-491: WHEN a caller presenting a valid client credential creates a match with `joinPolicy` `client`, THE SYSTEM SHALL apply every public-creation rule of 011 (public map list, public bounds, no `manual`, open-lobby cap, creation rates, lobby, host token in the reply) and SHALL store the policy `client` and the credential's namespace with the match, in the same transaction as the match itself. The namespace comes only from the credential, never from the body.
- FR-492: IF a creation asks for `joinPolicy` `client` without a valid client credential (anonymous, a host or player token, an unknown token), THEN THE SYSTEM SHALL refuse it with `forbidden` (403) and create, draw and store nothing. `joinPolicy` `open` is accepted from any caller allowed to create today.
- FR-493: WHEN the operator credential creates a match (008 path), THE SYSTEM SHALL refuse a `joinPolicy` member with `invalid-request` naming `joinPolicy`; operator matches stay open (OQ1).
- FR-494: THE SYSTEM SHALL offer no command, setting or path that changes the join policy or the owning namespace of an existing match; a restart, expiry, start, step or halt keeps both.
- FR-495: A repeated creation with the same request id and the same content from the same caller SHALL return the first reply (FR-238 unchanged); the same request id with or without `joinPolicy`, or with another value, is different content and answers `request-id-reused`.

**Enforcement**
- FR-496: IF a join request reaches a client-only match, THEN THE SYSTEM SHALL refuse it with the new closed code `joins-closed` (403), whatever the stage, the name, the player count or any credential presented (the operator's and the owning client's included: a join always makes a `player:` id), and SHALL store, draw and publish nothing. The check comes right after the match is found and before every stage, cap and name rule, so the reply is the same for every such request and reveals nothing about names, cap or stage. In the fixed order of FR-301, `joins-closed` comes after `too-many-matches` and before `match-halted`.
- FR-497: IF a prediction submission on a client-only match comes from a restricted caller (a client credential of another namespace, a player token, or any other caller), THEN THE SYSTEM SHALL answer `forbidden` at the place FR-301 already gives it, with the same reply as any other forbidden caller, and store nothing. A client credential of the owning namespace submits exactly as in 008/012.
- FR-498: THE SYSTEM SHALL keep every read (match view, summaries, states, records, players, results, winners, leaderboard, map files, public config) and the event stream public and unchanged for client-only matches; the own-prediction read keeps its 011 rule (a caller sees only its own namespace or player).
- FR-499: THE SYSTEM SHALL keep the host token's powers unchanged on a client-only match: it starts the lobby (011 FR-374) and nothing else; it neither joins, nor predicts, nor lifts the policy.
- FR-500: WHEN a refused join or submission on a client-only match passes the shape stage, THE SYSTEM SHALL count it against the existing join or submission limits exactly as any other refusal of that path (no new limit, no exemption).

**What clients see**
- FR-501: THE SYSTEM SHALL add to the public match view, and to each item of the match summaries list, an optional member `clientOnly` that is present with the value `true` exactly when the policy is `client` and absent otherwise; open matches keep their 011 bytes. No read, event, error or log carries the owning namespace. The creation reply carries the member through its match view.
- FR-502: THE SYSTEM SHALL keep the public config (014) unchanged: it gains no member for this spec.
- FR-503: THE SYSTEM SHALL extend the protocol's decoders and encoders with `joinPolicy`, `clientOnly` and `joins-closed`, with canonical forms; a decoder refuses `clientOnly` with any value other than `true`.

**Contract for the viewer (implemented by a follow-up Light-SDD web spec)**
- FR-504: WHEN the viewer opens a match whose view carries `clientOnly: true`, it SHALL open the live scene as a spectator (as 016 FR-470 does for `spectate=1`), never show the name door, and never send a join. IF a join is still refused with `joins-closed` (an old view, a race), THEN it SHALL fall back to spectating with one sentence from its strings module.

**Bot opt-in**
- FR-505: WHEN a channel member runs `/mbrg create`, THE bot SHALL create the match with `joinPolicy` `client` and its `discord` client credential as `Authorization: Bearer`. IF the server refuses the member (an older server), THEN the bot SHALL report that the server is unavailable and SHALL NOT retry as an open match. Matches the bot followed before keep their open policy.

**Persistence**
- FR-506: THE SYSTEM SHALL open a database written by 008 or 011 and upgrade it in place by adding storage only (no row rewritten); every existing match reads as `open`. A database of the new version opened by an older server is refused by the existing unknown-version rule. A client-only match survives a restart with its policy and owning namespace.

## Non-functional requirements
- NFR-100 (Secrecy): the policy is a creation input, not derived from the match secret, and adds nothing about any round: no future round, absorber, pending state or seed becomes readable, and the 008/011 secrecy tests pass unchanged. A scan over reads, events, error replies and log lines of a client-only run finds no namespace and no credential.
- NFR-101 (Determinism): the policy does not change the draws at creation (secret, match id, host token in their 011 order) nor any round: two creations with the same fake random source, one open and one client-only, give the same match id, commitment, records, states and events, differing only in `clientOnly` in the views.
- NFR-102 (Compatibility): every 008/011/014 golden keeps its bytes; any golden or test changed is listed in `PROGRESS.md` with its reason. Simulation, map format and `MatchState` are unchanged.
- NFR-103 (Bounds): no new unbounded body, list or store; `joinPolicy` is one of two short texts, read under the existing body limits.
- NFR-104 (Testability): the policy decisions (who may create, join refusal, submission refusal) are pure functions with the policy, namespace and caller as parameters, tested with Vitest; real-server tests cover each FR over HTTP.

## Edge cases
- Old match without a stored policy: open (FR-506).
- `joinPolicy: "open"` sent by an anonymous creator: accepted, same match as without the member (different memo content, FR-495).
- Client credential creating without `joinPolicy`: open public match, as today.
- Operator credential with `joinPolicy`: `invalid-request` (FR-493, OQ1).
- The owning client is removed from the server settings or renamed: the match stays client-only; nobody can predict in it; reads keep working (OQ3).
- A second client namespace (for example a future `telegram`) on a `discord` match: `forbidden` for submissions (FR-497).
- A join with the host token on a client-only match: `joins-closed` (FR-496, FR-499).
- Join on an unknown match id: `unknown-match` as before (existence is already public through reads).
- Join on a finished or expired client-only match: `joins-closed`, not the stage code (FR-496).
- An old viewer (before the follow-up web spec) on a client-only match: shows the door; the join is refused with `joins-closed`; it may show its generic error until updated.
- An old bot: keeps creating open matches.

## Out of scope
- Viewer UI details (follow-up Light-SDD web spec implementing FR-504).
- Discord display names in the viewer; per-server or cross-match history.
- Closing joins after creation, kicking players, lists of allowed namespaces, or operator-chosen namespaces.
- Changes to the simulation, the map format or `MatchState`.

## Done criteria
1. Tests written first for every id above (pure decisions, protocol codecs and goldens, store upgrade from a version-2 file, real-server HTTP for create/join/submit/reads/stream); ledger in `packages/sim/test/traceability.test.ts` extended.
2. Twin test for NFR-101; scan test for NFR-100; existing suites and goldens green (NFR-102).
3. `npm test` and `npm run typecheck` green; CI green.
4. Hand run: the bot creates a match; the viewer opens it, a join from it is refused with `joins-closed`, a Discord member predicts and scores normally.
5. The user accepts; status becomes `implemented`.

## Open questions
- OQ1: should the operator path also be able to create client-only matches (it would have to name a namespace in the body), or stay open as proposed in FR-493?
- OQ2: status for `joins-closed`: 403 (proposed, a permanent property of the match) or 409 (like `match-full`)?
- OQ3: if the owning client is removed from the settings, keep the match client-only (proposed) or treat it as open?
- OQ4: the bot opt-in (FR-505) ships in this spec's last milestone (proposed) or as its own small PR afterwards?

Decisions (user, 2026-11-15, all as proposed):
- OQ1: the operator path cannot create client-only matches (operator matches stay open).
- OQ2: `joins-closed` is 403.
- OQ3: if the owning client is removed from the settings, the match stays client-only.
- OQ4: the bot opt-in ships in the last milestone of this spec.
