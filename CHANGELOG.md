# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Roth Touchline SL underfloor heating through the public Roth Touchline SL
  API: one device per zone switched on, with its temperature, humidity,
  setpoint, heating state (idle, heating, cooling), program, mode, status,
  window flag and battery.
- Setpoint commands and program commands, each behind its own option, off
  by default; setpoints from 5 °C to a ceiling of 24 °C by default (16 to
  30 °C, never above 30 °C); a program only when all its temperatures stay
  within the same bounds; no command on a zone that cools or is switched
  off. Decided on a fresh read, sent within 3.5 s or refused unsent, "sent,
  without confirmation" when Roth stays silent.
- The token renewed by a new sign-in, never in a loop: never two sign-ins
  within a minute, a stop after a refused sign-in, spaced 15 min, 1 h, 6 h,
  24 h, kept in `/data` with the pauses after HTTP 429 or 5xx (never a
  secret in `/data`).
- "Test the connection" button, guides in English and French, cover image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-touchline-sl/commits/main
