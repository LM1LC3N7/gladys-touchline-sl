# gladys-touchline-sl

[Gladys Assistant](https://gladysassistant.com) external integration for the
**Roth Touchline SL** underfloor heating, through the public Roth Touchline
SL API (cloud, the account of the Roth app): one device per zone with its
temperature, humidity, setpoint, heating state, program, status and battery,
and two kinds of commands (setpoint, program), each behind its own
off-by-default option and bounded (5 °C to a ceiling of 24 °C by default,
30 °C at most). **Never tested with a real controller nor a real account.
Not affiliated with Roth.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (TouchlineApp)
                                  ├─ src/roth/client.js  Roth API, sign-in, token renewal without loop
                                  ├─ src/roth/http.js    node:https, deadline, 2 MB cap, `sent`
                                  ├─ src/model.js        answers -> checked values (pytouchlinesl shapes)
                                  ├─ src/devices.js      the zone devices and their states (pure)
                                  ├─ src/store.js        /data: pause, stop, last sign-in (no secret)
                                  └─ src/publisher.js    states within 300/min
```

- **Reads**: POST `/authentication` (e-mail, password) for a bearer token,
  GET `/users/{user}/modules` (at start, on a scan, then every 6 h) and
  `/users/{user}/modules/{udid}` for each controller every 60 s (30 s –
  10 min). Answers capped at 2 MB, keys that could reach a prototype
  dropped, every value checked against a plausible range.
- **Token**: kept in memory only; renewed by a new sign-in once when Roth
  refuses it, never two sign-ins within a minute (persisted), a stop after
  a token refused right after a sign-in or three renewals without a read.
- **Failures**: sign-in refused, a stop persisted in `/data`, next tries
  15 min, 1 h, 6 h, 24 h; HTTP 429/5xx a pause of 1 min to 6 h persisted in
  `/data`, applied to every path; anything else 30 s, 1, 2, 5 min, never
  under the interval; none of them cleared by a reconnection to Gladys.
- **Devices**: `ext:<selector>:touchline:<udid>-<zone>`; features appear
  once seen and are never lost on a republication. Temperature
  `temperature-sensor/decimal`, humidity `humidity-sensor/decimal`, setpoint
  `thermostat/target-temperature`, heating `thermostat/operating-state`
  (read only), program `text/select`, mode and status `text/text`, window
  `unknown/binary` (read only), battery `battery/integer`.
- **Commands** (`allow_setpoints`, `allow_programs`, both off by default):
  never a switch. A fresh read of the controller decides; the options and
  the ceiling are checked on arrival, after the read and right before the
  request leaves; sent within 3.5 s or refused unsent; "sent, without
  confirmation" after a silence or a 5xx, then reads 5 s and 20 s later;
  one at a time; never a sign-in inside a command. A program is sent back
  whole, as read, only when all its temperatures are within the bounds and
  the module was read entirely. A zone that cools is read only.

## Credits

The Roth API and the shapes of its answers are ported from
[pytouchlinesl](https://github.com/jnsgruk/pytouchlinesl) (jnsgruk,
Apache-2.0, 0.6.0), the library of Home Assistant's Touchline SL
integration. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Modelled
on the sibling integrations
[gladys-bsblan](https://github.com/LM1LC3N7/gladys-bsblan) (heating
commands behind an option, fresh read, guards) and
[gladys-tado](https://github.com/LM1LC3N7/gladys-tado) (cloud heating).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npm run cover                                   # cover.png, plain Node
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: Roth is a fake behind the injected HTTPS
transport (`test/fixtures/fakeRoth.js`), Gladys is the SDK's fake.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags,
builds the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from an Apache-2.0 project,
credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also shipped
in the Docker image).
