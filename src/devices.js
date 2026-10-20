// -----------------------------------------------------------------------------
// The zones of the Touchline SL controllers -> Gladys devices and states (pure).
//
// `ext:<selector>:touchline:<module>-<zone>`: one device per zone (a room),
// keyed by the id of its controller (udid) and the zone id Roth gives, as
// Home Assistant does (module-aware identifiers): stable when the zone is
// renamed. The feature roles (the last part of their external ids) are
// published forever: never rename them.
//
// A feature appears once its value was seen; a device published again never
// loses a feature: those of the device already created in Gladys are kept as
// they are (the core would mark it `structure_changed`, and "Update" would
// delete the missing feature and its history).
//
// No switch, no writable binary: a "turn everything off" (Google Home,
// Alexa, HomeKit, MCP, `switch.*` scenes) must never reach the heating. The
// commands are the setpoint (`thermostat/target-temperature`) and the
// program (`text/select`), refused unless the configuration allows them
// (src/app.js). The relay is the read-only `thermostat/operating-state`
// (idle / heating / cooling), the window flag a read-only `unknown/binary`.
//
// Units are those the core lists (DEVICE_FEATURE_UNITS_BY_CATEGORY): °C on
// `temperature-sensor` and `thermostat`, % on `humidity-sensor` and
// `battery`; none on the operating state.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { CONSTANT, FEATURES as F, OPERATING_STATE, SETPOINT } from './constants.js';
import {
  CONSTANT_NAME,
  FEATURE_NAMES,
  MODE_TEXTS,
  ZONE_STATE_TEXTS,
  deviceName,
  word,
} from './i18n.js';
import { programOf, scheduleOption } from './model.js';

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});
const text = sensor({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false });

/** The features, by role. */
export function definitionOf(role) {
  switch (role) {
    case F.TEMPERATURE:
      return sensor({
        category: C.TEMPERATURE_SENSOR,
        type: T.SENSOR.DECIMAL,
        unit: U.CELSIUS,
        min: -40,
        max: 80,
      });
    case F.HUMIDITY:
      return sensor({
        category: C.HUMIDITY_SENSOR,
        type: T.SENSOR.DECIMAL,
        unit: U.PERCENT,
        min: 0,
        max: 100,
      });
    case F.TARGET:
      return {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.TARGET_TEMPERATURE,
        unit: U.CELSIUS,
        // The slider stops at the hard bounds; the configured ceiling refuses below them.
        min: SETPOINT.min,
        max: SETPOINT.max,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      };
    case F.OPERATING:
      return sensor({
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.OPERATING_STATE,
        min: OPERATING_STATE.IDLE,
        max: OPERATING_STATE.COOLING,
      });
    case F.PROGRAM:
      return {
        category: C.TEXT,
        type: T.TEXT.SELECT,
        min: 0,
        max: 0,
        read_only: false,
        has_feedback: true,
        keep_history: false,
      };
    case F.MODE:
    case F.STATUS:
      return text;
    case F.WINDOW:
      return sensor({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 });
    case F.BATTERY:
      return sensor({
        category: C.BATTERY,
        type: T.BATTERY.INTEGER,
        unit: U.PERCENT,
        min: 0,
        max: 100,
      });
    default:
      throw new Error(`unknown role ${role}`);
  }
}

/** Display order. */
export const ROLES = [
  F.TEMPERATURE,
  F.HUMIDITY,
  F.TARGET,
  F.OPERATING,
  F.PROGRAM,
  F.MODE,
  F.STATUS,
  F.WINDOW,
  F.BATTERY,
];
export const COMMAND_ROLES = [F.TARGET, F.PROGRAM];

/** The fields of a feature Gladys stores (what is kept of a created feature). */
const DECLARED = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
  'supported_options',
];

export const zoneKey = (moduleId, zoneId) => `${moduleId}-${zoneId}`;
export const deviceIds = (gladys, moduleId, zoneId) =>
  gladys.externalIds('touchline', zoneKey(moduleId, zoneId));

const KEY = /:touchline:([A-Za-z0-9_-]{1,64})-(\d{1,10})/;

/** The module, the zone and the role of one of our feature external ids, else undefined. */
export function parseFeatureId(externalId) {
  if (typeof externalId !== 'string') {
    return undefined;
  }
  const match = new RegExp(`${KEY.source}:([a-z-]{1,40})$`).exec(externalId);
  if (!match || !ROLES.includes(match[3])) {
    return undefined;
  }
  return { moduleId: match[1], zoneId: Number(match[2]), role: match[3] };
}

/** The module and the zone of one of our device external ids, else undefined. */
export function parseDeviceId(externalId) {
  const match = new RegExp(`${KEY.source}$`).exec(String(externalId ?? ''));
  return match ? { moduleId: match[1], zoneId: Number(match[2]) } : undefined;
}

/** The roles the values of one read report. */
export function reportedRoles(zone) {
  const roles = new Set([F.MODE, F.STATUS]);
  if (zone.temperature !== undefined) {
    roles.add(F.TEMPERATURE);
  }
  if (zone.humidity !== undefined) {
    roles.add(F.HUMIDITY);
  }
  if (zone.target !== undefined) {
    roles.add(F.TARGET);
  }
  if (zone.relayOn !== undefined && zone.algorithm !== undefined) {
    roles.add(F.OPERATING);
  }
  if (zone.mode.id !== undefined) {
    roles.add(F.PROGRAM);
  }
  if (zone.windowOpen !== undefined) {
    roles.add(F.WINDOW);
  }
  if (zone.battery !== undefined) {
    roles.add(F.BATTERY);
  }
  return roles;
}

/** The options of the program select: the constant mode, then the global schedules. */
export function programOptions(schedules, language) {
  return [
    { value: CONSTANT, label: word(CONSTANT_NAME, language), sort_order: 0 },
    ...[...schedules]
      .sort((a, b) => a.index - b.index)
      .map((s, i) => ({ value: scheduleOption(s.index), label: s.name, sort_order: i + 1 })),
  ];
}

/**
 * The Gladys device of a zone. `roles`: those seen; `zone`, `module`,
 * `schedules`: of the last read (or undefined); `created`: the device already
 * created in Gladys, whose features are kept when the new build lacks them.
 */
export function buildDevice(
  gladys,
  { moduleId, zoneId },
  { roles, zone, module, schedules, language, created },
) {
  const ids = deviceIds(gladys, moduleId, zoneId);
  const params = [{ name: 'module', value: moduleId }];
  if (module?.name) {
    params.push({ name: 'controller', value: module.name });
  }
  if (module?.version) {
    params.push({ name: 'version', value: module.version });
  }
  const built = {
    name: created?.name ?? word(deviceName(zone?.name, zoneId), language),
    external_id: ids.device,
    model: module?.type ? `Roth Touchline SL (${module.type})` : 'Roth Touchline SL',
    should_poll: false,
    // The program list only when the programs of the module were read: never
    // a list shrunk to "constant" (the core would drop the stored options);
    // the feature already created is kept as it is meanwhile.
    features: ROLES.filter((role) => roles.has(role) && (role !== F.PROGRAM || schedules)).map(
      (role) => ({
        name: word(FEATURE_NAMES[role], language),
        external_id: ids.feature(role),
        ...definitionOf(role),
        ...(role === F.PROGRAM ? { supported_options: programOptions(schedules, language) } : {}),
      }),
    ),
    params,
  };
  return keepCreatedFeatures(built, created);
}

/** The features of the created device that the new build lacks, kept as they are. */
export function keepCreatedFeatures(built, created) {
  if (!created) {
    return built;
  }
  const have = new Set(built.features.map((f) => f.external_id));
  const kept = (created.features ?? [])
    .filter((f) => typeof f?.external_id === 'string' && !have.has(f.external_id))
    .map((f) =>
      Object.fromEntries(
        DECLARED.filter((k) => f[k] !== undefined && f[k] !== null).map((k) => [k, f[k]]),
      ),
    );
  return { ...built, features: [...built.features, ...kept] };
}

function modeText(zone, schedules, language) {
  switch (zone.mode.name) {
    case 'globalSchedule': {
      const schedule = schedules.find((s) => s.index === zone.mode.scheduleIndex);
      return word(
        MODE_TEXTS.globalSchedule(schedule?.name ?? `#${zone.mode.scheduleIndex}`),
        language,
      );
    }
    case 'constantTemp':
    case 'localSchedule':
    case 'timeLimit':
      return word(MODE_TEXTS[zone.mode.name], language);
    default:
      return word(MODE_TEXTS.unknown, language);
  }
}

/**
 * The current values of a zone. `status`: 'online', or 'offline' (Roth does
 * not answer) and 'gone' (the zone is no longer on the account): then only
 * the status text changes, Gladys keeps the last value of the others.
 */
export function deviceStates(ids, zone, { status = 'online', schedules = [], language }) {
  if (status !== 'online') {
    const shown = status === 'gone' ? ZONE_STATE_TEXTS.gone : ZONE_STATE_TEXTS.offline;
    return [{ device_feature_external_id: ids.feature(F.STATUS), text: word(shown, language) }];
  }
  const states = [
    { role: F.MODE, text: modeText(zone, schedules, language) },
    {
      role: F.STATUS,
      text: word(ZONE_STATE_TEXTS[zone.state ?? 'unknown'] ?? ZONE_STATE_TEXTS.unknown, language),
    },
  ];
  const numbers = {
    [F.TEMPERATURE]: zone.temperature,
    [F.HUMIDITY]: zone.humidity,
    [F.TARGET]: zone.target,
    [F.BATTERY]: zone.battery,
    [F.WINDOW]: zone.windowOpen === undefined ? undefined : zone.windowOpen ? 1 : 0,
    [F.OPERATING]:
      zone.relayOn === undefined || zone.algorithm === undefined
        ? undefined
        : !zone.relayOn
          ? OPERATING_STATE.IDLE
          : zone.algorithm === 'cooling'
            ? OPERATING_STATE.COOLING
            : OPERATING_STATE.HEATING,
  };
  for (const [role, value] of Object.entries(numbers)) {
    if (value !== undefined && Number.isFinite(value)) {
      states.push({ role, state: value });
    }
  }
  const program = programOf(zone);
  if (
    program !== undefined &&
    (program === CONSTANT || schedules.some((s) => scheduleOption(s.index) === program))
  ) {
    states.push({ role: F.PROGRAM, text: program });
  }
  return states.map(({ role, ...value }) => ({
    device_feature_external_id: ids.feature(role),
    ...value,
  }));
}
