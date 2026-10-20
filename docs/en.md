# Roth Touchline SL for Gladys

This integration shows the zones (rooms) of your **Roth Touchline SL**
underfloor heating in Gladys, through the public Roth Touchline SL API (the
cloud the Roth Touchline SL app uses), with the e-mail address and the
password of your Roth account.

**Never tested with a real controller nor a real account**: it follows the
pytouchlinesl library (the one of the Home Assistant integration), without
having been tried on a real installation. Tell us on the forum whether it
works for you. **Not affiliated with Roth.**

## What it does

For each zone switched on of each controller of the account, a device
"Room name (Touchline SL)" with:

- room temperature and humidity;
- setpoint (thermostat);
- heating running (idle, heating or cooling, read only);
- program (a list: constant temperature or one of the programs of the
  controller) and the mode read ("Program "Living"", "Constant
  temperature", "Temporary setpoint"…);
- zone status (OK, sensor damaged, no communication…);
- window open (when window sensors are paired), battery of the room
  thermostat.

Zones switched off in the controller are not offered.

## Setup

1. Install the integration from the Gladys store.
2. Enter the e-mail address and the password of your Roth Touchline SL
   account, then save. The password is kept by Gladys in its database,
   never shown again, sent only to Roth (roth-touchlinesl.com, over https).
3. Open the **Discovery** tab and add the zones you want.

The **Test the connection** button reads Roth once and shows its state.

## Commands (off by default)

By default Gladys only reads. Two separate options:

- **Allow the setpoint commands**: the dashboard, the scenes and the voice
  assistants can change the setpoint of a zone. The zone then goes to a
  constant temperature (it leaves its program, as in the Roth app).
- **Allow the program commands**: the "Program" list can put a zone on one
  of the programs of the controller, or on a constant temperature (with the
  setpoint it has).

Safety bounds:

- a setpoint goes from 5 °C to the **setpoint ceiling**, **24 °C by
  default**, adjustable from 16 to 30 °C, never more than 30 °C;
- a program is chosen only when **all** its temperatures stay within these
  bounds (else the command is refused);
- a zone that cools, is switched off or is unknown is never commanded;
- no command goes through a switch: a "turn everything off" of a voice
  assistant never reaches the heating. The Roth API has no command to turn
  the heating off.

Each command reads the zone again right before acting and decides on that
read; it leaves within 3.5 s or is refused with nothing sent. When Roth does
not answer in time after sending, Gladys shows "sent, without confirmation"
and reads the zone again 5 s and 20 s later. One command at a time. To
choose a program, Roth asks for the whole program to be sent back: the
integration sends it back as it just read it, changing nothing in it.

## Limits and safety

- Read every 60 s (from 30 s to 10 min).
- Credentials refused: a stop kept in `/data`, next tries after 15 min,
  1 h, 6 h then every 24 h, never in a loop; saving other credentials or
  pressing "Test the connection" tries again.
- Roth token refused: one new sign-in only, never two sign-ins within a
  minute (even after a restart); a token refused right after a sign-in, or
  three renewals without any successful read, give the stop above.
- Roth busy (HTTP 429) or failing (5xx): a pause of 1 min to 6 h, kept in
  `/data`, for the reads and the commands alike.
- `/data` never holds the e-mail address, the password nor the token.
- A command never signs in to Roth itself: when the token was just
  refused, it answers "try again in a minute".

## Credits

The Roth API and the shape of its answers come from
[pytouchlinesl](https://github.com/jnsgruk/pytouchlinesl) (jnsgruk,
Apache-2.0), the library of the Home Assistant integration. See
`THIRD_PARTY_NOTICES.md`.
