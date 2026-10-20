// -----------------------------------------------------------------------------
// The answers of the Roth API -> plain, checked values (pure). The shapes are
// those of pytouchlinesl 0.6.0 (client/models/models.py, zone.py). Only own
// keys are read, every number is checked against a plausible range, lists
// are cut to LIMITS, names to LIMITS.nameLength; one pass over each list.
// A value that does not fit is left out (undefined), never guessed.
// -----------------------------------------------------------------------------

import { CONSTANT, LIMITS } from './constants.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) =>
  isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined;
const int = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max ? value : undefined;

/** A name: printable, trimmed, cut; undefined when empty. */
export function nameOf(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  // Control characters out; one pass.
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return text === '' ? undefined : text.slice(0, LIMITS.nameLength);
}

const MODULE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The modules of the account (GET /users/{user}/modules) -> [{ id, name, type, version }]. */
export function modulesOf(data) {
  if (!Array.isArray(data)) {
    return undefined;
  }
  const list = [];
  const seen = new Set();
  for (const entry of data.slice(0, LIMITS.modules)) {
    const id = own(entry, 'udid');
    if (typeof id !== 'string' || !MODULE_ID.test(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    list.push({
      id,
      name: nameOf(own(entry, 'name')) ?? 'Touchline SL',
      type: nameOf(own(entry, 'type')),
      version: nameOf(own(entry, 'version')),
    });
  }
  return list;
}

export const ZONE_STATES = [
  'zoneOff',
  'noAlarm',
  'zoneUnregistered',
  'sensorDamaged',
  'noCommunication',
];
export const MODES = ['constantTemp', 'globalSchedule', 'localSchedule', 'timeLimit'];

/** A temperature in tenths of °C -> °C, within a plausible range. */
const tenthsToC = (value, min, max) => {
  const t = int(value, min * 10, max * 10);
  return t === undefined ? undefined : t / 10;
};

/** One zone element of a module -> the zone, or undefined without an id. */
export function zoneOf(element) {
  const zone = own(element, 'zone');
  const id = int(own(zone, 'id'), 0, 2 ** 31);
  if (id === undefined) {
    return undefined;
  }
  const flags = own(zone, 'flags');
  const mode = own(element, 'mode');
  const state = own(zone, 'zoneState');
  const modeName = own(mode, 'mode');
  const relay = own(flags, 'relayState');
  const algorithm = own(flags, 'algorithm');
  const window = own(flags, 'minOneWindowOpen');
  const humidity = int(own(zone, 'humidity'), 1, 100);
  return {
    id,
    name: nameOf(own(own(element, 'description'), 'name')),
    state: ZONE_STATES.includes(state) ? state : undefined,
    // pytouchlinesl: a current temperature of 0 (or null) means none.
    temperature:
      own(zone, 'currentTemperature') === 0
        ? undefined
        : tenthsToC(own(zone, 'currentTemperature'), -40, 80),
    target: tenthsToC(own(zone, 'setTemperature'), 0, 50),
    targetTenths: int(own(zone, 'setTemperature'), 0, 500),
    humidity,
    relayOn: relay === 'on' ? true : relay === 'off' ? false : undefined,
    algorithm: algorithm === 'heating' || algorithm === 'cooling' ? algorithm : undefined,
    windowOpen: typeof window === 'boolean' ? window : undefined,
    battery: int(own(zone, 'batteryLevel'), 0, 100),
    mode: {
      id: int(own(mode, 'id'), 0, 2 ** 31),
      name: MODES.includes(modeName) ? modeName : undefined,
      scheduleIndex: int(own(mode, 'scheduleIndex'), -1, 1000),
    },
  };
}

/** Empty intervals start and stop at 6100 (pytouchlinesl): never sent back. */
export const EMPTY_INTERVAL = 6100;
const MINUTES_IN_DAY = 24 * 60;

function daysOf(value) {
  if (!Array.isArray(value) || value.length !== 7 || !value.every((d) => d === '0' || d === '1')) {
    return undefined;
  }
  return [...value];
}

/** The intervals of a schedule, the empty ones dropped; undefined when one is malformed. */
function intervalsOf(value) {
  if (!Array.isArray(value) || value.length > 16) {
    return undefined;
  }
  const out = [];
  for (const entry of value) {
    const start = int(own(entry, 'start'), 0, EMPTY_INTERVAL);
    const stop = int(own(entry, 'stop'), 0, EMPTY_INTERVAL);
    const temp = int(own(entry, 'temp'), 0, 500);
    if (start === undefined || stop === undefined || temp === undefined) {
      return undefined;
    }
    if (start === EMPTY_INTERVAL || stop === EMPTY_INTERVAL) {
      continue;
    }
    if (start > MINUTES_IN_DAY || stop > MINUTES_IN_DAY) {
      return undefined;
    }
    out.push({ start, stop, temp });
  }
  return out;
}

/**
 * One global schedule -> { id, index, name, complete, temps, raw }. `complete`
 * only when every part needed to send it back is there and well formed;
 * `temps`: every temperature it may ask, in tenths.
 */
export function scheduleOf(entry) {
  const id = int(own(entry, 'id'), 0, 2 ** 31);
  const index = int(own(entry, 'index'), 0, 1000);
  if (id === undefined || index === undefined) {
    return undefined;
  }
  const p0Days = daysOf(own(entry, 'p0Days'));
  const p1Days = daysOf(own(entry, 'p1Days'));
  const p0Intervals = intervalsOf(own(entry, 'p0Intervals'));
  const p1Intervals = intervalsOf(own(entry, 'p1Intervals'));
  const p0SetbackTemp = int(own(entry, 'p0SetbackTemp'), 0, 500);
  const p1SetbackTemp = int(own(entry, 'p1SetbackTemp'), 0, 500);
  const rawName = own(entry, 'name');
  const name = nameOf(rawName);
  // Sent back as it is (a cut name would rename the program).
  const sendName =
    typeof rawName === 'string' && name && rawName.length <= 200 ? rawName : undefined;
  const parts = [p0Days, p1Days, p0Intervals, p1Intervals, p0SetbackTemp, p1SetbackTemp, sendName];
  const complete = !parts.includes(undefined);
  return {
    id,
    index,
    name: name ?? `#${index}`,
    complete,
    temps: complete
      ? [
          p0SetbackTemp,
          p1SetbackTemp,
          ...p0Intervals.map((i) => i.temp),
          ...p1Intervals.map((i) => i.temp),
        ]
      : [],
    sendName,
    body: complete
      ? { id, index, p0Days, p0SetbackTemp, p0Intervals, p1Days, p1SetbackTemp, p1Intervals }
      : undefined,
  };
}

/** One module (GET /users/{user}/modules/{module}) -> { zones, schedules }, or undefined. */
export function moduleOf(data) {
  const zones = own(data, 'zones');
  const elements = own(zones, 'elements');
  if (!Array.isArray(elements)) {
    return undefined;
  }
  const list = [];
  const seen = new Set();
  for (const element of elements.slice(0, LIMITS.zones)) {
    const zone = zoneOf(element);
    if (zone && !seen.has(zone.id)) {
      seen.add(zone.id);
      list.push(zone);
    }
  }
  const schedules = [];
  const indexes = new Set();
  const raw = own(own(zones, 'globalSchedules'), 'elements');
  for (const entry of Array.isArray(raw) ? raw.slice(0, LIMITS.schedules) : []) {
    const schedule = scheduleOf(entry);
    if (schedule && !indexes.has(schedule.index)) {
      indexes.add(schedule.index);
      schedules.push(schedule);
    }
  }
  // Complete only when every zone element was read: assigning a program sends
  // back the list of its zones, and a zone left out would leave the program.
  return { zones: list, schedules, complete: list.length === elements.length };
}

/** A zone shown in Gladys: switched on and registered (pytouchlinesl `enabled`, HA). */
export const isActive = (zone) =>
  zone.state !== undefined && zone.state !== 'zoneOff' && zone.state !== 'zoneUnregistered';

/** The option value of a schedule in the program select. */
export const scheduleOption = (index) => `schedule-${index}`;

/** The program a zone follows: 'constant', 'schedule-<index>', or undefined (other modes). */
export function programOf(zone) {
  if (zone.mode.name === 'constantTemp') {
    return CONSTANT;
  }
  if (zone.mode.name === 'globalSchedule' && zone.mode.scheduleIndex !== undefined) {
    return scheduleOption(zone.mode.scheduleIndex);
  }
  return undefined;
}
