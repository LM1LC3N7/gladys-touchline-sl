# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency (HTTPS goes through our own client on `node:https`). It
reads the zones of a Roth Touchline SL underfloor heating through the public
Roth Touchline SL API (cloud, e-mail address and password of the Roth
account) and shows one Gladys device per zone; setpoints and programs can be
changed behind two off-by-default options, bounded. Never tested with a real
controller nor a real account, not affiliated with Roth.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npm run cover                             # cover.png (800x534), plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` (Node 22 and 24) and `audit` before every
commit.

## Architecture

```
index.js                     SDK bootstrap only
src/handlers.js              every SDK handler -> the app (shared with the tests)
src/app.js                   TouchlineApp: polling, failures, pause/stop, devices, states,
                             badge, status, the test button, the commands, guards
src/roth/client.js           Roth API: sign-in, token renewal without loop, reads, writes
src/roth/http.js             node:https transport: deadline, size cap, `sent`, beforeSend
src/roth/errors.js           RothError codes, auth/busy helpers
src/model.js                 answers -> checked values (pytouchlinesl shapes)
src/devices.js               -> the Gladys devices and their states (pure), kept features
src/store.js                 /data/touchline-sl-state.json: pause, stop, last sign-in, no secret
src/publisher.js             states within 300/min
src/config.js                config_schema normalized (email, password, allow_setpoints,
                             allow_programs, max_setpoint, poll_interval, language)
src/constants.js             feature roles, limits, timings, the setpoint bounds
src/i18n.js                  runtime texts, feature names (en/fr)
test/fixtures/fakeRoth.js    the fake Roth API behind the transport; Gladys is the SDK's fake
scripts/cover.mjs            cover.png generator
```

## Rules

- **External ids are forever**: device `touchline:<udid>-<zone id>`,
  features `temperature`, `humidity`, `target-temperature`,
  `operating-state`, `program`, `mode`, `status`, `window-open`, `battery`.
  A republished device never loses a feature (`keepCreatedFeatures`).
- Manifest keys (`email`, `password`, `allow_setpoints`, `allow_programs`,
  `max_setpoint`, `poll_interval`, `language`, the action
  `test_connection`) are frozen.
- **Secrets**: the e-mail address, the password and the token never reach a
  log, a status, an error, `/data` (they live in private fields of the
  client). A secret field is "kept by Gladys in its database, never shown
  again", never said to be protected by a cipher.
- **Token**: renewed by a new sign-in once per refusal, never two sign-ins
  within a minute (persisted), a stop after a token refused right after a
  sign-in or three renewals without a read. Never a sign-in inside a command.
- **Failures**: refused credentials a stop persisted and spaced, 429/5xx a
  pause persisted and bounded, applied to every path; never read sooner than
  the interval; a reconnection to Gladys clears none of them.
- **The commands**: never a switch or a writable binary; each refused unless
  its option (checked on arrival, after the fresh read and right before the
  request leaves); decided on a fresh read only, refused when a value is
  missing; never sent after 3.5 s; "sent, without confirmation" after a
  silence or a 5xx; never retried; one at a time; the ack never waits for
  Gladys. Setpoints within 5 °C and the ceiling (24 °C by default, 30 °C at
  most); a program only when all its temperatures are within the same bounds
  and the module was read entirely, sent back as read. Cooling zones read
  only.
- Units only from the core's `DEVICE_FEATURE_UNITS_BY_CATEGORY`.
- Files are UTF-8 without BOM (`test/encoding.test.js`); tests never touch
  the network, nor the system temp folder.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
