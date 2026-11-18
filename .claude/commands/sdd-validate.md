---
description: SDD · Validate the spec FR by FR (tests + browser)
argument-hint: NNN-name
disable-model-invocation: true
---
Go through specs/$1/spec.md requirement by requirement. For each FR state which test covers it and the result of running it with `npm test`.

For interface FRs that cannot be tested with Vitest, verify them in the browser with screenshots of the debug scene (fixed seed + round), including the 375 px mobile view.

If any FR is not covered or fails, say so clearly. Do NOT fix anything yet. Then check the done criteria and give me a verdict: is the spec fulfilled?
