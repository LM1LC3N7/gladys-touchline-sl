// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake Roth API behind the injected HTTPS transport. Timers and
// Date are mocked: the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { TouchlineApp } from '../src/app.js';
import { ACTIONS, HOUR, MINUTE, SECOND } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { EMAIL, MODULE, NOW, PASSWORD, USER, fakeRoth, settle } from './fixtures/fakeRoth.js';

const CONFIG = { email: EMAIL, password: PASSWORD };
const SETPOINTS = { ...CONFIG, allow_setpoints: true };
const PROGRAMS = { ...CONFIG, allow_programs: true };
const KITCHEN = 2335;
const BEDROOM = 2354;
const device = (zone) => `ext:test-integration:touchline:${MODULE}-${zone}`;
const feature = (zone, role) => `${device(zone)}:${role}`;

async function setup(
  t,
  { config = CONFIG, roth = fakeRoth(), create = true, store = memoryStore(), logs = [] } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const app = new TouchlineApp({
    gladys,
    logger: recorder(logs),
    request: roth.request,
    store,
    now: () => Date.now(),
  });
  registerHandlers(gladys, app);
  const advance = async (ms, step = 100) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  const connecting = gladys.connect();
  await settle();
  await advance(SECOND, 50);
  await connecting;
  t.after(() => app.stop());
  if (create) {
    for (const d of [...gladys.fake.discoveredDevices]) {
      await gladys.fake.deviceCreated(d);
    }
    await settle();
  }
  /** A command on a feature of a created zone; resolves with the ack. */
  const command = async (zone, role, value, { wait = 5 * SECOND } = {}) => {
    const d = gladys.fake.devices.find((x) => x.external_id === device(zone));
    const target = d.features.find((f) => f.external_id === feature(zone, role)) ?? {
      external_id: feature(zone, role),
    };
    let ack;
    gladys.fake.setValue(d, target, value).then((a) => (ack = a));
    await settle();
    await advance(wait, 50);
    return ack;
  };
  return { gladys, app, roth, advance, logs, command, store };
}

const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

const last = (gladys, zone, role) => gladys.fake.lastState(feature(zone, role));
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const logins = (roth) => roth.requests.filter((r) => r.path === '/authentication').length;
const roles = (d) => d.features.map((f) => f.external_id.slice(d.external_id.length + 1));

test('an empty configuration asks for the account and reads nothing', async (t) => {
  const { gladys, roth } = await setup(t, { config: {} });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /adresse e-mail et le mot de passe/);
  assert.equal(roth.requests.length, 0);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /e-mail address and the password/);
});

test('signs in, lists the active zones, publishes their features and states', async (t) => {
  const logs = [];
  const { gladys, roth, store } = await setup(t, { logs });
  assert.equal(logins(roth), 1);
  assert.equal(roth.requests[0].body.username, EMAIL);
  assert.deepEqual(
    roth.requests.map((r) => `${r.method} ${r.path}`),
    ['POST /authentication', `GET /users/${USER}/modules`, `GET /users/${USER}/modules/${MODULE}`],
  );
  assert.equal(roth.requests[1].auth, 'Bearer token-1');
  const found = gladys.fake.discoveredDevices.map((d) => d.external_id).sort();
  assert.deepEqual(
    found,
    [device(KITCHEN), device(BEDROOM)].sort(),
    'the switched-off zone is left out',
  );
  const kitchen = gladys.fake.discoveredDevices.find((d) => d.external_id === device(KITCHEN));
  assert.equal(kitchen.name, 'Kitchen (Touchline SL)');
  assert.deepEqual(roles(kitchen), [
    'temperature',
    'humidity',
    'target-temperature',
    'operating-state',
    'program',
    'mode',
    'status',
    'window-open',
    'battery',
  ]);
  const byRole = Object.fromEntries(
    kitchen.features.map((f) => [roles(kitchen)[kitchen.features.indexOf(f)], f]),
  );
  assert.equal(byRole['target-temperature'].category, 'thermostat');
  assert.equal(byRole['target-temperature'].unit, 'celsius');
  assert.equal(byRole['target-temperature'].max, 30);
  assert.equal(byRole['operating-state'].read_only, true);
  assert.equal(byRole['operating-state'].unit, undefined);
  assert.ok(
    kitchen.features.every((f) => f.category !== 'switch'),
    'never a switch',
  );
  assert.deepEqual(
    byRole.program.supported_options.map((o) => [o.value, o.label]),
    [
      ['constant', 'Température constante'],
      ['schedule-0', 'Living Spaces'],
      ['schedule-1', 'Holiday'],
      ['schedule-2', 'Hot'],
    ],
  );
  assert.equal(last(gladys, KITCHEN, 'temperature'), 21.5);
  assert.equal(last(gladys, KITCHEN, 'target-temperature'), 20);
  assert.equal(last(gladys, KITCHEN, 'operating-state'), 1);
  assert.equal(last(gladys, KITCHEN, 'program'), 'schedule-0');
  assert.equal(last(gladys, KITCHEN, 'mode'), 'Programme « Living Spaces »');
  assert.equal(last(gladys, BEDROOM, 'program'), 'constant');
  assert.equal(last(gladys, BEDROOM, 'operating-state'), 0);
  assert.equal(last(gladys, BEDROOM, 'target-temperature'), 19);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).fr, /1 régulateur\(s\), 2 zone\(s\)/);
  assert.ok(gladys.fake.transports.length >= 2);
  assert.ok(gladys.fake.transports.every((e) => e.transport === DEVICE_TRANSPORTS.CLOUD));
  // Nothing secret anywhere.
  const everything = JSON.stringify([logs, gladys.fake.connectionStatuses, store.data]);
  assert.doesNotMatch(everything, /correct horse|jane@example|token-1/);
  assert.ok(store.data.lastLoginAt > 0);
});

test('reads every interval with the same token, never signing in again', async (t) => {
  const { roth, advance } = await setup(t);
  await advance(5 * MINUTE, 1000);
  assert.equal(logins(roth), 1);
  const reads = roth.requests.filter((r) => r.path === `/users/${USER}/modules/${MODULE}`).length;
  assert.ok(reads >= 5 && reads <= 6, `${reads} reads in 5 min`);
});

test('a refused token is renewed once, then reads go on', async (t) => {
  const { roth, advance, gladys } = await setup(t);
  await advance(2 * MINUTE, 1000);
  roth.revokeTokens();
  await advance(MINUTE + SECOND, 1000);
  assert.equal(logins(roth), 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  await advance(5 * MINUTE, 1000);
  assert.equal(logins(roth), 2);
});

test('a token refused right after a sign-in stops, spaced, never in a loop', async (t) => {
  const store = memoryStore();
  const roth = fakeRoth();
  // Every authenticated request is refused, even with a fresh token.
  roth.failNext((r) => r.path.startsWith('/users/'), { status: 401, times: 1000 });
  const { gladys, advance } = await setup(t, { roth, store, create: false });
  assert.equal(logins(roth), 1);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /refusé/);
  assert.ok(store.data.auth.until > NOW);
  await advance(14 * MINUTE, 10 * SECOND);
  assert.equal(logins(roth), 1, 'nothing before 15 min');
  await advance(2 * MINUTE, 10 * SECOND);
  assert.equal(logins(roth), 2);
  await advance(10 * HOUR, 10 * SECOND);
  assert.ok(logins(roth) <= 4, `${logins(roth)} sign-ins in 10 h`);
});

test('a refused password stops, persisted; a restart keeps the stop', async (t) => {
  const store = memoryStore();
  const roth = fakeRoth({ password: 'another' });
  const logs = [];
  const { gladys, app, advance } = await setup(t, { roth, store, create: false, logs });
  assert.equal(logins(roth), 1);
  assert.match(message(gladys).en, /refused the e-mail address or the password/);
  assert.match(message(gladys).en, /15 min/);
  assert.equal(store.data.auth.failures, 1);
  assert.doesNotMatch(JSON.stringify([store.data, logs]), /correct horse|jane@/);
  await advance(10 * MINUTE, 10 * SECOND);
  assert.equal(logins(roth), 1);
  // A restart of the container: the stop holds.
  app.stop();
  const again = new TouchlineApp({
    gladys,
    request: roth.request,
    store,
    now: () => Date.now(),
    logger: recorder([]),
  });
  await again.start(CONFIG);
  assert.equal(logins(roth), 1);
  again.stop();
});

test('the button tries again after a refusal, but never two sign-ins within a minute', async (t) => {
  const roth = fakeRoth({ password: 'another' });
  const { gladys, advance } = await setup(t, { roth, create: false });
  assert.equal(logins(roth), 1);
  const press = async () => {
    let ack;
    gladys.fake.action(ACTIONS.TEST_CONNECTION).then((a) => (ack = a));
    await advance(2 * SECOND, 50);
    return ack;
  };
  let ack = await press();
  assert.equal(logins(roth), 1, 'within the minute');
  assert.match(ack.data.message.fr, /une connexion par minute/);
  await advance(MINUTE, 1000);
  ack = await press();
  assert.equal(logins(roth), 2);
  assert.match(ack.data.message.fr, /refusé/);
});

test('saving other credentials lifts the stop', async (t) => {
  const roth = fakeRoth({ email: 'new@example.com' });
  const store = memoryStore({
    auth: { failures: 2, until: NOW + HOUR },
    pausedUntil: 0,
    lastLoginAt: 0,
  });
  const { gladys, advance } = await setup(t, { roth, store, create: false });
  assert.equal(logins(roth), 0, 'the stop survives a restart');
  gladys.fake.configUpdated({ ...CONFIG, language: 'en' });
  await advance(SECOND, 50);
  assert.equal(logins(roth), 0, 'the same credentials keep the stop');
  gladys.fake.configUpdated({ email: 'new@example.com', password: PASSWORD });
  await advance(SECOND, 50);
  assert.equal(logins(roth), 1);
  assert.equal(store.data.auth.failures, 0);
});

test('a restart within a minute of a sign-in waits for the minute', async (t) => {
  const store = memoryStore({
    pausedUntil: 0,
    auth: { failures: 0, until: 0 },
    lastLoginAt: NOW - 20 * SECOND,
  });
  const roth = fakeRoth();
  const { gladys, advance } = await setup(t, { roth, store, create: false });
  assert.equal(logins(roth), 0);
  assert.match(message(gladys).fr, /une connexion par minute/);
  await advance(30 * SECOND, 1000);
  assert.equal(logins(roth), 0, 'not before the interval');
  await advance(35 * SECOND, 1000);
  assert.equal(logins(roth), 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('HTTP 429 pauses every path, persisted, and a reconnection keeps the pause', async (t) => {
  const store = memoryStore();
  const roth = fakeRoth();
  const { gladys, app, advance, command } = await setup(t, { roth, store, config: SETPOINTS });
  roth.failNext((r) => r.method === 'GET', { status: 429, headers: { 'retry-after': '600' } });
  await advance(MINUTE + SECOND, 1000);
  assert.ok(store.data.pausedUntil >= NOW + 10 * MINUTE);
  assert.match(message(gladys).fr, /pause/);
  const before = roth.requests.length;
  await app.connected(SETPOINTS);
  const ack = await command(KITCHEN, 'target-temperature', 21);
  assert.equal(ack.success, false);
  assert.match(ack.error, /en pause/);
  await advance(8 * MINUTE, 10 * SECOND);
  assert.equal(roth.requests.length, before, 'nothing during the pause');
  await advance(3 * MINUTE, 10 * SECOND);
  assert.ok(roth.requests.length > before);
});

test('an unreachable Roth backs off, never sooner than the interval', async (t) => {
  const roth = fakeRoth();
  const { gladys, advance } = await setup(t, { roth });
  roth.failNext((r) => r.method === 'GET', { drop: true, times: 3 });
  await advance(MINUTE + SECOND, 1000);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /injoignable/);
  assert.equal(last(gladys, KITCHEN, 'status'), 'Roth Touchline SL injoignable');
  const at = roth.requests.length;
  await advance(59 * SECOND, 1000);
  assert.equal(roth.requests.length, at, 'not before the interval');
});

test('the setpoint: off by default, bounded, decided on a fresh read, then confirmed', async (t) => {
  const { gladys, roth, advance, command, app } = await setup(t);
  let ack = await command(KITCHEN, 'target-temperature', 21);
  assert.equal(ack.success, false);
  assert.match(ack.error, /commandes de consigne sont désactivées/);
  assert.equal(roth.writes().length, 0);
  await gladys.fake.configUpdated({ ...SETPOINTS });
  await settle();
  for (const value of [24.5, 31, 4, '', null, 'abc', 20.05, Number.NaN]) {
    ack = await command(KITCHEN, 'target-temperature', value, { wait: SECOND });
    assert.equal(ack.success, false, String(value));
  }
  assert.equal(roth.writes().length, 0);
  const reads = roth.requests.length;
  ack = await command(KITCHEN, 'target-temperature', 21.5);
  assert.equal(ack.success, true, ack.error);
  assert.equal(roth.requests.length, reads + 2, 'a fresh read, then the write');
  const [write] = roth.writes();
  assert.equal(write.path, `/users/${USER}/modules/${MODULE}/zones`);
  assert.deepEqual(write.body, {
    mode: {
      id: 2337,
      parentId: KITCHEN,
      mode: 'constantTemp',
      constTempTime: 0,
      setTemperature: 215,
      scheduleIndex: 0,
    },
  });
  await advance(20 * SECOND, 500);
  assert.equal(last(gladys, KITCHEN, 'target-temperature'), 21.5);
  assert.equal(last(gladys, KITCHEN, 'program'), 'constant');
  // The same value again: already so, nothing sent.
  ack = await command(KITCHEN, 'target-temperature', 21.5);
  assert.equal(ack.success, true);
  assert.equal(roth.writes().length, 1);
  // The ceiling lowered to 20 °C refuses 21.
  await gladys.fake.configUpdated({ ...SETPOINTS, max_setpoint: 20 });
  ack = await command(KITCHEN, 'target-temperature', 21);
  assert.match(ack.error, /de 5 à 20 °C/);
  // A ceiling typed above 30 °C stays at 30 °C.
  await gladys.fake.configUpdated({ ...SETPOINTS, max_setpoint: 45 });
  assert.equal(app.config.ceiling, 30);
});

test('the option turned off during the fresh read: nothing sent', async (t) => {
  const roth = fakeRoth();
  const { gladys, command, app } = await setup(t, { roth, config: SETPOINTS });
  roth.failNext((r) => r.method === 'GET', { delay: 400 });
  const pending = command(KITCHEN, 'target-temperature', 22);
  app.config = { ...app.config, allowSetpoints: false };
  const ack = await pending;
  assert.equal(ack.success, false);
  assert.match(ack.error, /désactivées/);
  assert.equal(roth.writes().length, 0);
  assert.ok(gladys);
});

test('a slow fresh read is refused unsent; a silent write is "sent, without confirmation"', async (t) => {
  const roth = fakeRoth();
  const { command } = await setup(t, { roth, config: SETPOINTS });
  roth.failNext((r) => r.method === 'GET', { delay: 3000 });
  let ack = await command(KITCHEN, 'target-temperature', 22);
  assert.equal(ack.success, false);
  assert.match(ack.error, /trop lentement/);
  assert.equal(roth.writes().length, 0);
  roth.failNext((r) => r.method === 'POST' && r.path.endsWith('/zones'), { hang: true });
  ack = await command(KITCHEN, 'target-temperature', 22, { wait: 6 * SECOND });
  assert.equal(ack.success, false);
  assert.match(ack.error, /envoyée, sans confirmation/);
  assert.equal(roth.writes().length, 1);
});

test('a refused write is "refused", a 5xx write "sent, without confirmation"', async (t) => {
  const roth = fakeRoth();
  const { command, advance } = await setup(t, { roth, config: SETPOINTS });
  roth.failNext((r) => r.method === 'POST' && r.path.endsWith('/zones'), { status: 400 });
  let ack = await command(KITCHEN, 'target-temperature', 22);
  assert.match(ack.error, /Roth a refusé la commande \(HTTP 400\)/);
  await advance(5 * SECOND, 500);
  roth.failNext((r) => r.method === 'POST' && r.path.endsWith('/zones'), { status: 502 });
  ack = await command(KITCHEN, 'target-temperature', 22);
  assert.match(ack.error, /envoyée, sans confirmation \(HTTP 502\)/);
});

test('no sign-in inside a command: a refused token gives "try again", the poll renews it', async (t) => {
  const roth = fakeRoth();
  const { command, advance } = await setup(t, { roth, config: SETPOINTS });
  await advance(90 * SECOND, 1000);
  roth.revokeTokens();
  const ack = await command(KITCHEN, 'target-temperature', 22);
  assert.match(ack.error, /Reconnexion à Roth/);
  assert.equal(roth.writes().length, 0);
  assert.equal(logins(roth), 1, 'never a sign-in inside a command');
  await advance(MINUTE, 1000);
  assert.equal(logins(roth), 2, 'the next poll renews the token');
  const again = await command(KITCHEN, 'target-temperature', 22);
  assert.equal(again.success, true, again.error);
});

test('programs: off by default, bounded by the ceiling, the whole program sent back', async (t) => {
  const { gladys, roth, advance, command } = await setup(t);
  let ack = await command(BEDROOM, 'program', 'schedule-1');
  assert.match(ack.error, /commandes de programme sont désactivées/);
  await gladys.fake.configUpdated({ ...PROGRAMS });
  ack = await command(BEDROOM, 'program', 'schedule-2');
  assert.match(ack.error, /hors de 5–24 °C/, 'the program "Hot" asks 26 °C');
  ack = await command(BEDROOM, 'program', 'schedule-9');
  assert.match(ack.error, /n’existe plus/);
  ack = await command(BEDROOM, 'program', 'nonsense');
  assert.match(ack.error, /Programme inconnu/);
  assert.equal(roth.writes().length, 0);
  ack = await command(KITCHEN, 'program', 'schedule-1');
  assert.equal(ack.success, true, ack.error);
  const [write] = roth.writes();
  assert.equal(write.path, `/users/${USER}/modules/${MODULE}/zones/${KITCHEN}/global_schedule`);
  assert.equal(write.body.scheduleName, 'Holiday');
  assert.deepEqual(write.body.setInZones, [{ zoneId: KITCHEN, modeId: 2337 }]);
  assert.equal(write.body.schedule.index, 1);
  assert.deepEqual(
    write.body.schedule.p0Intervals,
    [
      { start: 300, stop: 540, temp: 160 },
      { start: 1020, stop: 1200, temp: 160 },
    ],
    'the empty intervals (6100) are not sent back',
  );
  await advance(20 * SECOND, 500);
  assert.equal(last(gladys, KITCHEN, 'program'), 'schedule-1');
  assert.equal(last(gladys, KITCHEN, 'mode'), 'Programme « Holiday »');
  // The constant mode keeps the setpoint the zone has.
  ack = await command(KITCHEN, 'program', 'constant');
  assert.equal(ack.success, true, ack.error);
  assert.equal(roth.writes()[1].body.mode.setTemperature, 200);
});

test('a cooling or switched-off zone is never commanded', async (t) => {
  const roth = fakeRoth();
  roth.zone(BEDROOM).zone.flags.algorithm = 'cooling';
  const { command } = await setup(t, { roth, config: { ...SETPOINTS, allow_programs: true } });
  let ack = await command(BEDROOM, 'target-temperature', 21);
  assert.match(ack.error, /rafraîchissement/);
  roth.zone(KITCHEN).zone.zoneState = 'zoneOff';
  ack = await command(KITCHEN, 'program', 'constant');
  assert.match(ack.error, /zone est éteinte/);
  assert.equal(roth.writes().length, 0);
});

test('read-only features refuse commands; one command at a time', async (t) => {
  const roth = fakeRoth();
  const { command, gladys } = await setup(t, { roth, config: SETPOINTS });
  let ack = await command(KITCHEN, 'temperature', 21);
  assert.match(ack.error, /lecture seule/);
  ack = await command(KITCHEN, 'operating-state', 1);
  assert.match(ack.error, /lecture seule/);
  roth.failNext((r) => r.method === 'GET', { delay: 1000 });
  const d = gladys.fake.devices.find((x) => x.external_id === device(KITCHEN));
  const f = d.features.find((x) => x.external_id === feature(KITCHEN, 'target-temperature'));
  const first = gladys.fake.setValue(d, f, 22);
  await settle();
  const second = gladys.fake.setValue(d, f, 23);
  for (let i = 0; i < 60; i += 1) {
    t.mock.timers.tick(100);
    await settle();
  }
  assert.equal((await first).success, true);
  assert.match((await second).error, /Une autre commande/);
});

test('a republished zone never loses a feature; a reconnection republishes status and discovery', async (t) => {
  const roth = fakeRoth();
  const { gladys, app, advance } = await setup(t, { roth });
  roth.zone(KITCHEN).zone.batteryLevel = null;
  await advance(MINUTE + SECOND, 1000);
  await app.scan();
  const kitchen = gladys.fake.discoveredDevices.find((d) => d.external_id === device(KITCHEN));
  assert.ok(roles(kitchen).includes('battery'));
  const published = gladys.fake.connectionStatuses.length;
  await app.connected(CONFIG);
  assert.ok(gladys.fake.connectionStatuses.length > published);
  assert.ok(gladys.fake.discoveredDevices.length >= 2);
});
