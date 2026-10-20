// -----------------------------------------------------------------------------
// The answers of Roth -> checked values; the configuration; /data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ceilingOf, connectionKey, normalizeConfig } from '../src/config.js';
import { HOUR } from '../src/constants.js';
import { deviceStates, parseDeviceId, parseFeatureId } from '../src/devices.js';
import { isActive, moduleOf, modulesOf, programOf } from '../src/model.js';
import { normalizeMemory, serializeMemory } from '../src/store.js';
import { moduleData, schedule, zone } from './fixtures/fakeRoth.js';

test('modules: only well-formed ids, deduplicated, bounded', () => {
  const list = modulesOf([
    { udid: 'abc123', name: 'Home', type: 'zones_controller', version: 'L-11' },
    { udid: 'abc123', name: 'Twice' },
    { udid: '../x', name: 'Bad' },
    { name: 'No id' },
    ...Array.from({ length: 20 }, (_, i) => ({ udid: `m${i}` })),
  ]);
  assert.equal(list[0].id, 'abc123');
  assert.equal(list[0].name, 'Home');
  assert.ok(list.length <= 8);
  assert.equal(modulesOf({}), undefined);
});

test('a module: zones in °C, schedules complete, empty intervals dropped', () => {
  const parsed = moduleOf(moduleData());
  assert.equal(parsed.complete, true);
  const [kitchen, bedroom, off] = parsed.zones;
  assert.equal(kitchen.temperature, 21.5);
  assert.equal(kitchen.target, 20);
  assert.equal(kitchen.targetTenths, 200);
  assert.equal(kitchen.relayOn, true);
  assert.equal(programOf(kitchen), 'schedule-0');
  assert.equal(programOf(bedroom), 'constant');
  assert.equal(isActive(off), false);
  assert.equal(off.temperature, undefined);
  assert.equal(off.humidity, undefined, 'a humidity of 0 is none');
  const living = parsed.schedules[0];
  assert.equal(living.complete, true);
  assert.equal(living.body.p0Intervals.length, 2);
  assert.deepEqual(living.temps, [180, 180, 200, 200]);
});

test('implausible values are left out, never guessed', () => {
  const element = zone(1, 'X', { current: 9999, set: -5, battery: 300, humidity: 150 });
  element.zone.zoneState = 'weird';
  element.mode.mode = 'other';
  const [parsed] = moduleOf({ zones: { elements: [element] } }).zones;
  assert.equal(parsed.temperature, undefined);
  assert.equal(parsed.target, undefined);
  assert.equal(parsed.battery, undefined);
  assert.equal(parsed.humidity, undefined);
  assert.equal(parsed.state, undefined);
  assert.equal(isActive(parsed), false);
  assert.equal(programOf(parsed), undefined);
});

test('a malformed schedule is incomplete; a module with too many zones is incomplete', () => {
  const broken = schedule(1, 0, 'Broken');
  broken.p0Days = ['1', '1'];
  const parsed = moduleOf({ zones: { elements: [], globalSchedules: { elements: [broken] } } });
  assert.equal(parsed.schedules[0].complete, false);
  const many = moduleOf({
    zones: { elements: Array.from({ length: 70 }, (_, i) => zone(i * 10, `Z${i}`)) },
  });
  assert.equal(many.zones.length, 64);
  assert.equal(many.complete, false);
  assert.equal(moduleOf({ zones: {} }), undefined);
  assert.equal(moduleOf(null), undefined);
});

test('external ids parse back; unknown roles do not', () => {
  const id = 'ext:x:touchline:abc-def_1-2335';
  assert.deepEqual(parseDeviceId(id), { moduleId: 'abc-def_1', zoneId: 2335 });
  assert.deepEqual(parseFeatureId(`${id}:target-temperature`), {
    moduleId: 'abc-def_1',
    zoneId: 2335,
    role: 'target-temperature',
  });
  assert.equal(parseFeatureId(`${id}:nope`), undefined);
  assert.equal(parseFeatureId(42), undefined);
});

test('states never carry undefined nor NaN', () => {
  const ids = { feature: (role) => `f:${role}` };
  const [parsed] = moduleOf({
    zones: { elements: [zone(1, 'X', { current: null, battery: null })] },
  }).zones;
  for (const s of deviceStates(ids, parsed, { schedules: [], language: 'en' })) {
    if ('state' in s) {
      assert.ok(Number.isFinite(s.state), s.device_feature_external_id);
    } else {
      assert.equal(typeof s.text, 'string');
    }
  }
  assert.deepEqual(deviceStates(ids, undefined, { status: 'offline', language: 'en' }), [
    { device_feature_external_id: 'f:status', text: 'Roth Touchline SL unreachable' },
  ]);
});

test('configuration: commands off unless true, ceiling 16–30 °C, secrets compared in memory only', () => {
  const c = normalizeConfig({ email: ' jane@example.com ', password: 'p' });
  assert.equal(c.email, 'jane@example.com');
  assert.equal(c.allowSetpoints, false);
  assert.equal(c.allowPrograms, false);
  assert.equal(c.ceiling, 24);
  assert.equal(c.pollInterval, 60);
  for (const value of ['yes', 1, 'TRUE', null]) {
    assert.equal(normalizeConfig({ allow_setpoints: value }).allowSetpoints, false, String(value));
  }
  assert.equal(normalizeConfig({ allow_programs: 'true' }).allowPrograms, true);
  assert.equal(ceilingOf(45), 30);
  assert.equal(ceilingOf(10), 16);
  assert.equal(ceilingOf(''), 24);
  assert.equal(ceilingOf('22.7'), 22);
  assert.equal(normalizeConfig({}).problem, 'empty');
  assert.equal(normalizeConfig({ email: 'x', password: 'p' }).problem, 'badEmail');
  assert.equal(normalizeConfig({ email: 'a@b' }).problem, 'noPassword');
  assert.equal(normalizeConfig({ poll_interval: 5 }).pollInterval, 30);
  assert.notEqual(
    connectionKey(normalizeConfig({ email: 'a@b', password: 'one' })),
    connectionKey(normalizeConfig({ email: 'a@b', password: 'two' })),
  );
});

test('/data: bounded, known keys only, never a secret', () => {
  const now = 1_000_000;
  const memory = normalizeMemory(
    {
      pausedUntil: now + 100 * HOUR,
      auth: { failures: 3, until: now + 100 * HOUR },
      lastLoginAt: now + HOUR,
      token: 'x',
      __proto__: { polluted: true },
    },
    now,
  );
  assert.equal(memory.pausedUntil, now + 6 * HOUR);
  assert.equal(memory.auth.until, now + 24 * HOUR);
  assert.equal(memory.lastLoginAt, now, 'a time ahead of the clock counts as now');
  assert.deepEqual(Object.keys(serializeMemory(memory)).sort(), [
    'auth',
    'lastLoginAt',
    'pausedUntil',
  ]);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(normalizeMemory('garbage', now), {
    pausedUntil: 0,
    auth: { failures: 0, until: 0 },
    lastLoginAt: 0,
  });
});

test('a half-empty interval makes the program incomplete; only empty ones are dropped', () => {
  for (const half of [
    { start: 6100, stop: 600, temp: 200 },
    { start: 300, stop: 6100, temp: 200 },
  ]) {
    const s = schedule(1, 0, 'Half');
    s.p0Intervals = [{ start: 300, stop: 540, temp: 200 }, half];
    const [parsed] = moduleOf({
      zones: { elements: [], globalSchedules: { elements: [s] } },
    }).schedules;
    assert.equal(parsed.complete, false, JSON.stringify(half));
  }
});

test('a zone whose mode cannot be read makes the module incomplete', () => {
  const variants = [
    (e) => (e.mode.mode = 'other'),
    (e) => delete e.mode.id,
    (e) => (e.mode.scheduleIndex = 'x'),
  ];
  for (const change of variants) {
    const data = moduleData();
    // The kitchen follows a global schedule.
    change(data.zones.elements[0]);
    assert.equal(moduleOf(data).complete, false, String(change));
  }
  assert.equal(moduleOf(moduleData()).complete, true);
});

test('a name cut at its maximum never ends with a space', () => {
  const s = schedule(1, 0, `${'a'.repeat(59)} tail`);
  const [parsed] = moduleOf({
    zones: { elements: [], globalSchedules: { elements: [s] } },
  }).schedules;
  assert.equal(parsed.name, 'a'.repeat(59));
  assert.equal(parsed.sendName, `${'a'.repeat(59)} tail`, 'sent back unchanged');
});
