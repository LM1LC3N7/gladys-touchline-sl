# TODO

## Status

Milestone 1 (0.1.0, local commit, not pushed): reads of the zones, setpoint
and program commands behind two off-by-default options, bounded. Never
tested with a real controller nor a real Roth account. The store validator
(`npx github:GladysAssistant/integration-store .`) could not be run from the
development agent: run it before publishing. No end-to-end test in a
container (no Docker on the development PC).

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag (`ghcr.io/lm1lc3n7/gladys-touchline-sl:0.1.0`):
  the first patch release gives 0.1.1.
- **Reference**: pytouchlinesl 0.6.0 (Apache-2.0, jnsgruk), the library of
  Home Assistant's integration, read at commit 886af35 (license checked in
  its `LICENSE`: Apache-2.0, no `NOTICE`). Ported, not copied; credited in
  `THIRD_PARTY_NOTICES.md`, shipped in the image.
- **Neighbours**: gladys-bsblan (structure, commands, guards, store,
  publisher) and gladys-tado (cloud heating). Read only, nothing changed in
  them.
- **One device per zone**, external id `touchline:<udid>-<zone id>` (as Home
  Assistant's module-aware identifiers). Only zones not `zoneOff` nor
  `zoneUnregistered` are offered; a created zone that disappears shows
  "Zone not found on the account".
- **Token**: the API has no renewal token and no documented lifetime. Kept
  in memory only (never in `/data`: no secret there), renewed by signing in
  again when Roth refuses it (401), once per refusal; never two sign-ins
  within a minute (the time of the last sign-in is persisted, so a restart
  loop cannot sign in faster); a token refused right after a sign-in, or
  three renewals without any successful read, is a stop like refused
  credentials (15 min, 1 h, 6 h, 24 h). Status 400/401/403/422 of
  `/authentication` count as refused credentials.
- **Commands never sign in** (no room in the 3.5 s budget): when the token
  was just refused, the command answers "try again in a minute" and the next
  poll renews the token.
- **Two options** (`allow_setpoints`, `allow_programs`), off by default,
  checked on arrival, after the fresh read and in `beforeSend`.
- **Bounds**: setpoints 5 °C to a ceiling of 24 °C by default (16–30 °C,
  hard max 30 °C), steps of 0.1 °C (the API speaks tenths). A program is
  assigned only when every temperature it holds (setbacks and intervals)
  lies within the same bounds, when it was read whole (days, intervals,
  setbacks, name) and when every zone element of the module was read (the
  request lists the zones of the program: a zone left out would leave it).
  The program is sent back as read (empty 6100 intervals left out, as
  pytouchlinesl does), its name unchanged.
- **Cooling zones are read only** in this version (a low setpoint while
  cooling risks condensation on the floor); a switched-off zone is never
  commanded.
- **No protective command**: the Roth API has no command to turn the
  heating off; lowering a setpoint stays behind the option like any other.
- **Constant temperature** in the program list keeps the setpoint the zone
  has now (as Home Assistant), refused when it is outside the bounds.
- **No switch, no writable binary**; the relay is the read-only
  `thermostat/operating-state` (0 idle, 1 heating, 2 cooling, the values of
  the core's `THERMOSTAT_OPERATING_STATE`).
- **Units**: °C on `temperature-sensor` and `thermostat`, % on
  `humidity-sensor` and `battery`, none on the operating state (core
  `DEVICE_FEATURE_UNITS_BY_CATEGORY` and `_AND_TYPE`).
- **Signal strength** (`signalStrength`) left out: its scale is not
  documented.
- **No energy index**: the API gives none.
- **A read begun before a write** is dropped (the follow-up reads 5 s and
  20 s later show the result), so a stale value never lifts a guard.
- **Polling 60 s by default** (Home Assistant: 30 s), 30 s minimum.

## Next

- Test with a real account (lifetime of the token, the error of a wrong
  password, the answer of the writes, the 0.5 °C step of the Roth app).
- The program options are frozen at the creation of the device: a program
  renamed or added later changes the `supported_options` of the feature;
  check how the core takes it.
- Local schedules (`localSchedule`) and temporary setpoints (`timeLimit`):
  shown, not commanded.
- Cooling zones: commands with their own bounds.
