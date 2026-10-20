// -----------------------------------------------------------------------------
// The Roth Touchline SL API, as pytouchlinesl 0.6.0 uses it
// (client/client.py):
//   - POST /authentication { username, password } -> { user_id, token }: the
//     token is then sent as `authorization: Bearer <token>`;
//   - GET /users/{user}/modules: the modules (controllers) of the account;
//   - GET /users/{user}/modules/{module}: its zones and global schedules;
//   - POST /users/{user}/modules/{module}/zones: a constant setpoint;
//   - POST /users/{user}/modules/{module}/zones/{zone}/global_schedule: a
//     zone onto a global schedule (the whole schedule is sent again).
//
// The token (no renewal token, no documented lifetime) is renewed by signing
// in again, never in a loop: a refused token is renewed once, only when it
// is older than a minute and no other sign-in happened within the minute
// (`mayLogin`, persisted by the app); a token refused right after a sign-in,
// a token renewed three times without any read going through in between,
// or a sign-in refused, ends with REFUSED (a stop the app persists). The
// e-mail address, the password and the token live in private fields only:
// never on a property a log could print.
// -----------------------------------------------------------------------------

import { LIMITS, ROTH, TIMINGS } from '../constants.js';
import { CODES, RothError } from './errors.js';
import { httpsRequest } from './http.js';

/** Retry-After: seconds or an HTTP date, in ms (undefined when absent or unreadable). */
export function retryAfterMs(value, now) {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string' || text.length > 64) {
    return undefined;
  }
  if (/^\s*\d{1,7}\s*$/.test(text)) {
    return Number(text) * 1000;
  }
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** JSON, keys that could reach a prototype dropped; BAD_ANSWER when it is not JSON. */
export function parseJson(text) {
  try {
    return JSON.parse(text, (key, value) => (UNSAFE_KEYS.has(key) ? undefined : value));
  } catch {
    throw new RothError(CODES.BAD_ANSWER, { sent: true });
  }
}

const MODULE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A module id (udid) or a zone id that may go into a path, else an error. */
function segment(value) {
  const text = String(value);
  if (!MODULE_ID.test(text)) {
    throw new Error('bad id');
  }
  return text;
}

export class RothClient {
  #email;
  #password;
  #token = null;
  #userId = null;
  #tokenAt = 0;
  #login = null;
  /** Token renewals (after a 401) since the last read that went through. */
  #renewals = 0;

  /**
   * @param {object} options
   * @param {string} options.email
   * @param {string} options.password
   * @param {Function} [options.request] the HTTPS transport (tests inject a fake Roth)
   * @param {() => boolean} [options.mayLogin] whether a sign-in may leave now
   * @param {() => void} [options.onLogin] called when a sign-in leaves
   */
  constructor({
    email,
    password,
    request = httpsRequest,
    now = Date.now,
    mayLogin = () => true,
    onLogin = () => {},
  }) {
    this.#email = email;
    this.#password = password;
    this.request = request;
    this.now = now;
    this.mayLogin = mayLogin;
    this.onLogin = onLogin;
    this.closed = false;
  }

  close() {
    this.closed = true;
    this.#token = null;
  }

  /** Whether a token is held (for the commands: they never sign in). */
  get hasSession() {
    return this.#token !== null;
  }

  /** The token of the last sign-in, dropped (the next read signs in again). */
  dropSession() {
    this.#token = null;
  }

  /**
   * One request to the API. `answerBy`, `startBy`: absolute times;
   * `beforeSend`: the last check, right before the request leaves.
   */
  async exchange(
    method,
    path,
    { body, answerBy, startBy, beforeSend, auth = true, ignoreBody = false } = {},
  ) {
    if (this.closed) {
      throw new RothError(CODES.CLOSED);
    }
    const now = this.now();
    const timeout = answerBy === undefined ? TIMINGS.requestTimeout : answerBy - now;
    if (timeout <= 0 || (startBy !== undefined && startBy <= now)) {
      throw new RothError(CODES.LATE);
    }
    if (beforeSend) {
      try {
        beforeSend();
      } catch (err) {
        err.beforeSend = true;
        throw err;
      }
    }
    const token = this.#token;
    if (auth && token === null) {
      throw new RothError(CODES.NO_SESSION);
    }
    let answer;
    try {
      answer = await this.request({
        method,
        url: `${ROTH.apiUrl}${path}`,
        headers: auth ? { authorization: `Bearer ${token}` } : {},
        body: body === undefined ? undefined : JSON.stringify(body),
        timeout,
        ...(startBy === undefined ? {} : { sendWithin: startBy - now }),
        maxBytes: LIMITS.responseBytes,
        ...(beforeSend ? { beforeSend } : {}),
      });
    } catch (err) {
      if (err instanceof RothError || err?.beforeSend) {
        throw err;
      }
      throw new RothError(CODES.UNREACHABLE);
    }
    if (this.closed) {
      throw new RothError(CODES.CLOSED, { sent: true });
    }
    if (answer.status === 401 && auth && this.#token === token) {
      // This token is refused: the next read signs in again (never in a loop).
      this.#token = null;
    }
    if (answer.status < 200 || answer.status > 299) {
      throw new RothError(CODES.HTTP, {
        status: answer.status,
        retryAfterMs: retryAfterMs(answer.headers?.['retry-after'], this.now()),
        sent: true,
      });
    }
    // A write accepted (2xx) is accepted, whatever its body says.
    const text = ignoreBody ? '' : String(answer.body ?? '');
    return text.trim() === '' ? null : parseJson(text);
  }

  /** Signs in (one at a time). REFUSED for wrong credentials; NO_SESSION within the minute. */
  login() {
    if (!this.#login) {
      this.#login = this.signIn().finally(() => {
        this.#login = null;
      });
    }
    return this.#login;
  }

  async signIn() {
    if (!this.mayLogin()) {
      throw new RothError(CODES.NO_SESSION);
    }
    this.onLogin();
    let data;
    try {
      data = await this.exchange(
        'POST',
        '/authentication',
        // The field is named `username`; Roth signs in with the e-mail address.
        { body: { username: this.#email, password: this.#password }, auth: false },
      );
    } catch (err) {
      if (err.code === CODES.HTTP && [400, 401, 403, 422].includes(err.status)) {
        throw new RothError(CODES.REFUSED, { status: err.status, sent: true });
      }
      throw err;
    }
    const token = data?.token;
    const userId = data?.user_id;
    if (
      typeof token !== 'string' ||
      token === '' ||
      token.length > LIMITS.tokenLength ||
      /[^\x21-\x7e]/.test(token) ||
      !Number.isSafeInteger(userId) ||
      userId < 0
    ) {
      throw new RothError(CODES.BAD_ANSWER, { sent: true });
    }
    this.#token = token;
    this.#userId = userId;
    this.#tokenAt = this.now();
  }

  /**
   * A read of the polling: signs in when no token is held; a token refused
   * (401) is renewed once when it is older than the minute, else REFUSED.
   */
  async read(path) {
    if (this.#token === null) {
      await this.login();
    }
    try {
      return this.accepted(await this.exchange('GET', path(this.#userId)));
    } catch (err) {
      if (!(err.code === CODES.HTTP && err.status === 401)) {
        throw err;
      }
      if (
        this.now() - this.#tokenAt < TIMINGS.loginFloor ||
        this.#renewals >= LIMITS.renewalsWithoutRead
      ) {
        // Refused right after a sign-in, or renewed again and again without
        // a single read: the account cannot read this. A stop, not a loop.
        throw new RothError(CODES.REFUSED, { status: 401, sent: true });
      }
      this.#renewals += 1;
      await this.login();
      try {
        return this.accepted(await this.exchange('GET', path(this.#userId)));
      } catch (again) {
        if (again.code === CODES.HTTP && again.status === 401) {
          throw new RothError(CODES.REFUSED, { status: 401, sent: true });
        }
        throw again;
      }
    }
  }

  /** A read went through: the renewals count from zero again. */
  accepted(data) {
    this.#renewals = 0;
    return data;
  }

  /** The modules of the account (an array, checked by src/model.js). */
  modules() {
    return this.read((user) => `/users/${user}/modules`);
  }

  /** One module: its zones and global schedules. */
  async module(moduleId) {
    const id = segment(moduleId);
    return this.read((user) => `/users/${user}/modules/${id}`);
  }

  // --- The commands: never a sign-in, deadlines given by the app ------------

  /** A fresh read of one module for a command (NO_SESSION without a token). */
  async freshModule(moduleId, options) {
    const id = segment(moduleId);
    return this.exchange('GET', `/users/${this.#userId}/modules/${id}`, options);
  }

  /** A constant setpoint for a zone (pytouchlinesl set_zone_temperature). */
  async setZoneTemperature({ moduleId, modeId, zoneId, tenths }, options) {
    const id = segment(moduleId);
    return this.exchange('POST', `/users/${this.#userId}/modules/${id}/zones`, {
      body: {
        mode: {
          id: modeId,
          parentId: zoneId,
          mode: 'constantTemp',
          constTempTime: 0,
          setTemperature: tenths,
          scheduleIndex: 0,
        },
      },
      ...options,
      ignoreBody: true,
    });
  }

  /** A zone onto a global schedule (pytouchlinesl set_zone_schedule): the whole schedule. */
  async setZoneSchedule({ moduleId, zoneId, payload }, options) {
    const id = segment(moduleId);
    const zone = segment(zoneId);
    return this.exchange(
      'POST',
      `/users/${this.#userId}/modules/${id}/zones/${zone}/global_schedule`,
      { body: payload, ...options, ignoreBody: true },
    );
  }
}
