# Working in this repo

## Always build against the live Plethora contract

Every session that touches a bit — a new one, a revision, a doc change about
the contract — starts by fetching the current contract from its canonical
origin and checking the versions. Not from memory, not from a cached copy,
not from this repo's notes. Those notes (the root README, `_skills/sekai/`)
describe the contract as it was when they were written; the contract itself
is only ever what the origin serves right now.

1. `https://plethora.studio/llms.txt` names the current agent origin (as of
   2026-10-21 that is `https://agent.plethora.studio`). Then
   `GET <origin>/v1/agent` — JSON with `contextVersion`, `agentApiOrigin`,
   the resource list and the endpoints.
2. From that origin, fetch together: `creation.md`, `fundamentals.md`, the
   complete `sdk.md` (not only the topic pages), `schema.json`,
   `best-practices.md`, `common-mistakes.md`, `upload.md`; `libraries.json`
   when a dependency is involved; `existing-code.md` for a conversion.
3. Every document carries a `Context version:` line (`schema.json` and
   `workflow.json` carry `contextVersion` and `sdkVersion`). All of them must
   agree with each other and with the index. A host serving an older context
   version than another host is stale — the newer one wins, never a mix.
4. If the creator names a version, the fetched documents must match it before
   any code is written. If they do not, the host is wrong: go back to
   `llms.txt` and the index rather than arguing from what was fetched.
5. Re-read `upload.md` before every upload. The endpoint, headers, body and
   response shape are part of the contract and have changed before.
6. When the contract has moved since the local notes were written, updating
   the notes is part of the job: the root README's *Working on a bit*,
   `_skills/sekai/SKILL.md`, `references/gotchas.md`, `scripts/check.py` and
   `scripts/upload.py`.

Why this is a rule: the old `api.plethora.studio` host kept serving context
`2026-09-06.1` (SDK 1.5.7), cache-busting or not and with no pointer to the
newer origin, long after `agent.plethora.studio` had `2026-10-20.1` (SDK
1.7.0) with full-screen bits. A session built against the stale one and had
to redo the work after the creator pointed out the real version.
