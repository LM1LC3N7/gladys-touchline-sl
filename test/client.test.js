// -----------------------------------------------------------------------------
// The Roth client on its own: sign-in, token renewal without loop, answers
// checked, nothing secret in an error. The transport is a stub (no network).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { RothClient, parseJson, retryAfterMs } from '../src/roth/client.js';
import { CODES } from '../src/roth/errors.js';
import { httpsRequest } from '../src/roth/http.js';

/** A stub transport: `answers` is a function of the request, or a list served in order. */
function stub(answers) {
  const requests = [];
  const request = async (options) => {
    requests.push(options);
    const next = typeof answers === 'function' ? answers(options) : answers.shift();
    if (next instanceof Error) {
      throw next;
    }
    return {
      status: next.status,
      headers: next.headers ?? {},
      body: JSON.stringify(next.body ?? {}),
    };
  };
  return { request, requests };
}

const signIn = (token = 'abc') => ({ status: 200, body: { user_id: 7, token } });

function client(transport, { clock = { t: 1_000_000 }, mayLogin } = {}) {
  return new RothClient({
    email: 'jane@example.com',
    password: 'secret pass',
    request: transport.request,
    now: () => clock.t,
    ...(mayLogin ? { mayLogin } : {}),
  });
}

test('signs in once, then reads with the bearer token', async () => {
  const transport = stub([signIn('tok'), { status: 200, body: [] }, { status: 200, body: [] }]);
  const c = client(transport);
  await c.modules();
  await c.modules();
  const [login, first, second] = transport.requests;
  assert.equal(login.method, 'POST');
  assert.equal(login.url, 'https://roth-touchlinesl.com/api/v1/authentication');
  assert.deepEqual(JSON.parse(login.body), {
    username: 'jane@example.com',
    password: 'secret pass',
  });
  assert.equal(first.url, 'https://roth-touchlinesl.com/api/v1/users/7/modules');
  assert.equal(first.headers.authorization, 'Bearer tok');
  assert.equal(second.headers.authorization, 'Bearer tok');
  assert.equal(transport.requests.length, 3);
  // The secrets live in private fields: a log of the client never shows them.
  assert.doesNotMatch(`${JSON.stringify(c)} ${inspect(c)}`, /secret pass|jane@|tok/);
});

test('a refused sign-in is REFUSED, without the credentials in the error', async () => {
  for (const status of [400, 401, 403, 422]) {
    const c = client(stub([{ status, body: { error: 'jane@example.com secret pass' } }]));
    const err = await c.modules().catch((e) => e);
    assert.equal(err.code, CODES.REFUSED, String(status));
    assert.doesNotMatch(`${err.message} ${err.stack}`, /jane|secret/);
  }
  const busy = await client(stub([{ status: 503 }]))
    .modules()
    .catch((e) => e);
  assert.equal(busy.code, CODES.HTTP);
  assert.equal(busy.status, 503);
});

test('a sign-in answer without a usable token is a bad answer', async () => {
  for (const body of [
    {},
    { token: '', user_id: 7 },
    { token: 'a b', user_id: 7 },
    { token: 'x', user_id: '7' },
    { token: 'x'.repeat(5000), user_id: 7 },
  ]) {
    const err = await client(stub([{ status: 200, body }]))
      .modules()
      .catch((e) => e);
    assert.equal(err.code, CODES.BAD_ANSWER, JSON.stringify(body).slice(0, 40));
  }
});

test('a refused token is renewed once when older than a minute', async () => {
  const clock = { t: 1_000_000 };
  const transport = stub([
    signIn('one'),
    { status: 200, body: [] },
    { status: 401 },
    signIn('two'),
    { status: 200, body: [] },
  ]);
  const c = client(transport, { clock });
  await c.modules();
  clock.t += 2 * 60_000;
  await c.modules();
  assert.equal(transport.requests.filter((r) => r.url.endsWith('/authentication')).length, 2);
  assert.equal(transport.requests.at(-1).headers.authorization, 'Bearer two');
});

test('a token refused right after the sign-in is REFUSED, no second sign-in', async () => {
  const transport = stub([signIn(), { status: 401 }]);
  const err = await client(transport)
    .modules()
    .catch((e) => e);
  assert.equal(err.code, CODES.REFUSED);
  assert.equal(transport.requests.length, 2);
});

test('renewed three times without a read in between: REFUSED, never a loop', async () => {
  const clock = { t: 1_000_000 };
  const transport = stub((r) => (r.url.endsWith('/authentication') ? signIn() : { status: 401 }));
  const c = client(transport, { clock });
  const codes = [];
  for (let i = 0; i < 6; i += 1) {
    clock.t += 2 * 60_000;
    codes.push((await c.modules().catch((e) => e)).code);
  }
  assert.ok(codes.every((code) => code === CODES.REFUSED));
  const logins = transport.requests.filter((r) => r.url.endsWith('/authentication')).length;
  assert.ok(logins <= 7, `${logins} sign-ins`);
});

test('no sign-in when the app forbids it (the minute between two)', async () => {
  const transport = stub([]);
  const err = await client(transport, { mayLogin: () => false })
    .modules()
    .catch((e) => e);
  assert.equal(err.code, CODES.NO_SESSION);
  assert.equal(transport.requests.length, 0);
});

test('a command never signs in: NO_SESSION without a token', async () => {
  const transport = stub([]);
  const c = client(transport);
  const err = await c.freshModule('abc', {}).catch((e) => e);
  assert.equal(err.code, CODES.NO_SESSION);
  assert.equal(transport.requests.length, 0);
});

test('a deadline already past sends nothing; beforeSend refuses before anything leaves', async () => {
  const clock = { t: 1_000_000 };
  const transport = stub([signIn(), { status: 200, body: [] }]);
  const c = client(transport, { clock });
  await c.modules();
  const late = await c
    .setZoneTemperature({ moduleId: 'm', modeId: 1, zoneId: 2, tenths: 200 }, { answerBy: clock.t })
    .catch((e) => e);
  assert.equal(late.code, CODES.LATE);
  const refused = await c
    .setZoneTemperature(
      { moduleId: 'm', modeId: 1, zoneId: 2, tenths: 200 },
      {
        answerBy: clock.t + 1000,
        beforeSend: () => {
          throw new Error('off');
        },
      },
    )
    .catch((e) => e);
  assert.equal(refused.beforeSend, true);
  assert.equal(transport.requests.length, 2);
});

test('ids that could change the path are refused', async () => {
  const c = client(stub([signIn(), { status: 200, body: {} }]));
  for (const id of ['../x', 'a/b', 'a?b', '', 'x'.repeat(65)]) {
    await assert.rejects(() => c.module(id));
  }
});

test('JSON: keys that could reach a prototype are dropped; Retry-After read', () => {
  const value = parseJson('{"__proto__":{"polluted":1},"a":{"constructor":{"x":1},"b":2}}');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(value, '__proto__'), false);
  assert.deepEqual(value.a, { b: 2 });
  assert.throws(
    () => parseJson('<html>'),
    (e) => e.code === CODES.BAD_ANSWER,
  );
  assert.equal(retryAfterMs('120', 0), 120_000);
  assert.equal(retryAfterMs('soon', 0), undefined);
  assert.equal(retryAfterMs(undefined, 0), undefined);
});

test('the transport speaks https only', async () => {
  const err = await httpsRequest({
    method: 'GET',
    url: 'http://example.invalid/',
    timeout: 1000,
    maxBytes: 10,
  }).catch((e) => e);
  assert.equal(err.code, CODES.UNREACHABLE);
  assert.equal(err.sent, false);
});

test('the time of a sign-in is saved before the sign-in leaves', async () => {
  const transport = stub([signIn(), { status: 200, body: [] }]);
  let release;
  const saved = new Promise((resolve) => (release = resolve));
  const c = new RothClient({
    email: 'a@b',
    password: 'p',
    request: transport.request,
    onLogin: () => saved,
  });
  const reading = c.modules();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(transport.requests.length, 0, 'waits for the save');
  release();
  await reading;
  assert.equal(transport.requests.length, 2);
});
