// -----------------------------------------------------------------------------
// A fake Roth Touchline SL API behind the injected HTTPS transport: the
// sign-in, the modules, the zones and the two writes, with the shapes of
// pytouchlinesl's sample data (tests/sample-data). Its timers are those of
// the test (mocked); `failNext` makes the next matching requests fail.
// -----------------------------------------------------------------------------

import { CODES, RothError } from '../../src/roth/errors.js';

export const NOW = Date.UTC(2026, 9, 20, 18, 0, 0);
export const EMAIL = 'jane@example.com';
export const PASSWORD = 'correct horse';
export const MODULE = '1234a5678a9123a456a7891234a56789';
export const USER = 4242;

export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const empty = { start: 6100, stop: 6100, temp: 200 };

export function schedule(id, index, name, { temp = 200, setback = 180 } = {}) {
  return {
    id,
    parentId: 2333,
    index,
    name,
    p0Days: ['1', '1', '1', '1', '1', '1', '1'],
    p0SetbackTemp: setback,
    p0Intervals: [{ start: 300, stop: 540, temp }, { start: 1020, stop: 1200, temp }, empty],
    p1Days: ['0', '0', '0', '0', '0', '0', '0'],
    p1SetbackTemp: setback,
    p1Intervals: [empty, empty, empty],
  };
}

export function zone(
  id,
  name,
  {
    current = 215,
    set = 200,
    state = 'noAlarm',
    mode = 'globalSchedule',
    index = 0,
    relay = 'off',
    algorithm = 'heating',
    battery = 100,
    humidity = 55,
  } = {},
) {
  return {
    zone: {
      id,
      parentId: 2333,
      time: '2026-10-20T18:00:00',
      duringChange: false,
      index: 0,
      currentTemperature: current,
      setTemperature: set,
      flags: {
        relayState: relay,
        minOneWindowOpen: false,
        algorithm,
        floorSensor: 0,
        humidityAlgorytm: 0,
        zoneExcluded: 0,
      },
      zoneState: state,
      signalStrength: 23,
      batteryLevel: battery,
      actuatorsOpen: 0,
      humidity,
      visibility: true,
    },
    description: {
      id: id + 1,
      parentId: id,
      name,
      styleId: 3,
      styleIcon: 'x',
      duringChange: false,
    },
    mode: {
      id: id + 2,
      parentId: id,
      mode,
      constTempTime: 60,
      setTemperature: set,
      scheduleIndex: index,
    },
    schedule: schedule(id + 4, -1, 'local'),
    actuators: [],
    underfloor: {},
    windowsSensors: [],
    additionalContacts: [],
  };
}

export function moduleData() {
  return {
    zones: {
      transaction_time: '2026-10-20T18:00:00+02:00',
      elements: [
        zone(2335, 'Kitchen', { mode: 'globalSchedule', index: 0, relay: 'on' }),
        zone(2354, 'Bedroom', { mode: 'constantTemp', set: 190 }),
        zone(2373, 'Zone 3', {
          current: null,
          state: 'zoneOff',
          mode: 'timeLimit',
          battery: null,
          humidity: 0,
        }),
      ],
      globalSchedules: {
        time: '2026-10-20T18:00:00',
        duringChange: false,
        elements: [
          schedule(2948, 0, 'Living Spaces'),
          schedule(2967, 1, 'Holiday', { temp: 160, setback: 150 }),
          schedule(2986, 2, 'Hot', { temp: 260 }),
        ],
      },
      controllerParameters: {
        controllerMode: {
          id: 1,
          parentId: 0,
          type: 108,
          txtId: 0,
          iconId: 0,
          value: 0,
          menuId: 1000,
        },
        globalSchedulesNumber: {},
      },
    },
    tiles: [],
  };
}

export function fakeRoth({ email = EMAIL, password = PASSWORD } = {}) {
  const roth = {
    requests: [],
    tokens: new Set(),
    issued: 0,
    modules: [
      {
        id: 0,
        default: false,
        name: 'Home',
        email,
        type: 'zones_controller',
        version: 'ROTH: L-11 (v.1.0.6)',
        udid: MODULE,
      },
    ],
    data: moduleData(),
    /** [{ match: (req) => bool, status, delay, hang, error, times }] */
    failures: [],
    delay: 50,
    failNext(match, outcome) {
      roth.failures.push({ times: 1, ...outcome, match });
    },
    revokeTokens() {
      roth.tokens.clear();
    },
    zone(id) {
      return roth.data.zones.elements.find((e) => e.zone.id === id);
    },
    writes() {
      return roth.requests.filter((r) => r.method === 'POST' && r.path !== '/authentication');
    },
    request: (options) => handle(roth, { email, password }, options),
  };
  return roth;
}

function answer(status, body, headers = {}) {
  return { status, headers, body: body === undefined ? '' : JSON.stringify(body) };
}

function handle(
  roth,
  account,
  { method, url, headers = {}, body, timeout, sendWithin, beforeSend },
) {
  const path = url.replace('https://roth-touchlinesl.com/api/v1', '');
  return new Promise((resolve, reject) => {
    const failure = roth.failures.find((f) => f.match({ method, path }));
    if (failure) {
      failure.times -= 1;
      if (failure.times <= 0) {
        roth.failures.splice(roth.failures.indexOf(failure), 1);
      }
    }
    const connectDelay = failure?.connectDelay ?? 0;
    let sent = false;
    const timer = setTimeout(() => reject(new RothError(CODES.TIMEOUT, { sent })), timeout);
    if (sendWithin !== undefined && connectDelay > sendWithin) {
      clearTimeout(timer);
      setTimeout(() => reject(lateError()), Math.max(0, sendWithin));
      return;
    }
    setTimeout(() => {
      if (beforeSend) {
        try {
          beforeSend();
        } catch (err) {
          clearTimeout(timer);
          err.beforeSend = true;
          err.sent = false;
          reject(err);
          return;
        }
      }
      sent = true;
      const parsed = body === undefined ? undefined : JSON.parse(body);
      const request = { method, path, auth: headers.authorization, body: parsed };
      roth.requests.push(request);
      if (failure?.hang) {
        return;
      }
      setTimeout(() => {
        clearTimeout(timer);
        if (failure?.drop) {
          reject(dropError());
          return;
        }
        if (failure?.status) {
          resolve(answer(failure.status, failure.body ?? { error: 'x' }, failure.headers));
          return;
        }
        resolve(route(roth, account, request));
      }, failure?.delay ?? roth.delay);
    }, connectDelay);
  });
}

// The transport errors as src/roth/http.js gives them.
const lateError = () => new RothError(CODES.LATE);
const dropError = () => new RothError(CODES.UNREACHABLE, { sent: true });

function route(roth, account, { method, path, auth, body }) {
  if (method === 'POST' && path === '/authentication') {
    if (body?.username !== account.email || body?.password !== account.password) {
      return answer(401, { error: 'Invalid credentials' });
    }
    roth.issued += 1;
    const token = `token-${roth.issued}`;
    roth.tokens.add(token);
    return answer(200, { user_id: USER, token });
  }
  const token = /^Bearer (.+)$/.exec(auth ?? '')?.[1];
  if (!token || !roth.tokens.has(token)) {
    return answer(401, { error: 'Unauthorized' });
  }
  if (method === 'GET' && path === `/users/${USER}/modules`) {
    return answer(200, roth.modules);
  }
  if (method === 'GET' && path === `/users/${USER}/modules/${MODULE}`) {
    return answer(200, roth.data);
  }
  if (method === 'POST' && path === `/users/${USER}/modules/${MODULE}/zones`) {
    const mode = body.mode;
    const element = roth.zone(mode.parentId);
    if (!element || element.mode.id !== mode.id) {
      return answer(400, { error: 'bad zone' });
    }
    element.mode.mode = 'constantTemp';
    element.zone.setTemperature = mode.setTemperature;
    element.mode.setTemperature = mode.setTemperature;
    return answer(200, {});
  }
  const match = new RegExp(`^/users/${USER}/modules/${MODULE}/zones/(\\d+)/global_schedule$`).exec(
    path,
  );
  if (method === 'POST' && match) {
    for (const { zoneId } of body.setInZones) {
      const element = roth.zone(zoneId);
      element.mode.mode = 'globalSchedule';
      element.mode.scheduleIndex = body.schedule.index;
    }
    return answer(200, {});
  }
  return answer(404, { error: 'not found' });
}
