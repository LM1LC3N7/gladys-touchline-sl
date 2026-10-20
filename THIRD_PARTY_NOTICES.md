# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the project below. The ported parts
were rewritten, not copied; the changes are described below.

## pytouchlinesl

<https://github.com/jnsgruk/pytouchlinesl> (package `pytouchlinesl`, the
library of Home Assistant's Roth Touchline SL integration), by jnsgruk and
contributors. Apache License 2.0 (`LICENSE` of the repository, version 0.6.0
of 2026-02-12, read at commit 886af35). The repository has no `NOTICE` file.
The full text of the Apache License 2.0 is the `LICENSE` file of this
integration (the same text). Its notice:

```
Copyright jnsgruk

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

Ported in `src/roth/client.js` and `src/model.js`: the Roth Touchline SL API
as the library uses it (`client/client.py`): the base address
`https://roth-touchlinesl.com/api/v1`, POST `/authentication` with
`{ username, password }` giving `{ user_id, token }` and the bearer token,
GET `/users/{user}/modules` and `/users/{user}/modules/{udid}`, POST
`/users/{user}/modules/{udid}/zones` with the `constantTemp` mode (tenths of
°C), POST `/users/{user}/modules/{udid}/zones/{zone}/global_schedule` with
the whole schedule and the zones already on it, the empty intervals (6100)
left out; the shapes of the answers (`client/models/models.py`); the zone
values (`zone.py`: tenths of °C, the zone enabled unless `zoneOff`, the
alarms, the relay and the heating or cooling algorithm).

Changed: our own HTTPS client on `node:https` (a deadline and a size cap per
answer, never retried, keys that could reach a prototype dropped); the token
renewed by a new sign-in at most once per refusal, never two sign-ins
within a minute, a stop after a refused sign-in or a token refused again
(pytouchlinesl signs in once and never renews); every value checked against
a plausible range and only own keys read; the commands behind two options
off by default, decided on a fresh read of the module, the setpoint bounded
(5 °C to a ceiling of 24 °C by default, 30 °C at most), a program assigned
only when all its temperatures are within the same bounds and the module was
read entirely; no command on a zone that cools or is switched off; HTTP 429
and 5xx persisted in `/data` and spaced.
