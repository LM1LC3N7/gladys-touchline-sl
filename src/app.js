// -----------------------------------------------------------------------------
// The integration: the Roth Touchline SL account typed in the configuration
// (e-mail address and password), one read of its controllers every poll
// interval, one Gladys device per zone and its states, the transport badge,
// the "Test the connection" button, and the two commands (a setpoint, a
// program), each refused unless its own option allows it. index.js only
// wires the SDK handlers.
//
// Failures (lessons of the previous waves):
//   - sign-in refused (wrong e-mail or password), or a fresh token refused:
//     a stop persisted in /data, next tries 15 min, 1 h, 6 h then every
//     24 h, never in a loop; saving other credentials or "Test the
//     connection" tries again;
//   - the token (no documented lifetime) is renewed by signing in again,
//     once, when Roth refuses it; never two sign-ins within a minute, even
//     across a restart (the time of the last one is kept in /data);
//   - HTTP 429 or 5xx: a pause of 1 min to 6 h, persisted in /data, applied
//     to every path (polls, commands, the button);
//   - anything else: 30 s, 1, 2, 5 min, never sooner than the interval;
//   - a reconnection to Gladys clears none of them.
//
// The commands follow the rules learnt on the previous modules (as the
// sibling gladys-bsblan):
//   - decided on a fresh read of the controller only, never on the values
//     kept in memory, and refused when a value is missing;
//   - the options and the setpoint ceiling are checked on arrival, after
//     the fresh read and right before the request leaves (beforeSend);
//   - sent within 3.5 s of the click or refused unsent; answered by 4.3 s;
//   - a write that may have reached Roth (silence, a dropped connection, a
//     5xx) is never answered "not sent": "sent, without confirmation", then
//     spaced reads;
//   - the ack never waits for a publication to Gladys;
//   - one command at a time; never retried; never a sign-in inside a
//     command (no time for it): "try again in a minute".
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { connectionKey, normalizeConfig } from './config.js';
import { CONSTANT, FEATURES as F, SECOND, SETPOINT, TIMINGS } from './constants.js';
import {
  COMMAND_ROLES,
  buildDevice,
  deviceIds,
  deviceStates,
  parseDeviceId,
  parseFeatureId,
  reportedRoles,
} from './devices.js';
import { ERRORS, T, age, word } from './i18n.js';
import { isActive, moduleOf, modulesOf, programOf, scheduleOption } from './model.js';
import { RothClient } from './roth/client.js';
import { CODES, RothError, isAuthRefused, isBusy, reasonOf } from './roth/errors.js';
import { StatePublisher } from './publisher.js';
import { memoryStore, normalizeMemory, serializeMemory } from './store.js';

/** A number sent by Gladys: a finite number, or a plain decimal text ('' and null are not 0). */
function numberOf(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && /^-?\d{1,3}(\.\d{1,3})?$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

/** What a command compares, for a role: the mode and setpoint, or the program. */
function comparable(role, zone) {
  if (role === F.TARGET) {
    return zone.mode.name === undefined || zone.targetTenths === undefined
      ? undefined
      : `${zone.mode.name}:${zone.targetTenths}`;
  }
  // A zone on its own program or on a temporary setpoint compares as its
  // mode: any choice of the list then differs and is sent.
  return programOf(zone) ?? (zone.mode.name === undefined ? undefined : `mode:${zone.mode.name}`);
}

const zoneKeyOf = (moduleId, zoneId) => `${moduleId}:${zoneId}`;

export class TouchlineApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'touchline-sl' }),
    request,
    store = memoryStore(),
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    /** The HTTPS transport (tests); node:https otherwise. */
    this.request = request;
    this.store = store;
    this.now = now;
    this.timers = timers;
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.account = undefined;
    /** What survives a restart (src/store.js), loaded at the first start. */
    this.memory = normalizeMemory(null, now());
    this.memoryLoaded = false;
    this.saveWarned = false;
    /** `${module}:${zone}` -> the roles seen during this run (a feature never disappears). */
    this.seen = new Map();
    this.generation = 0;
    this.started = false;
    this.lastStatus = undefined;
    this.published = undefined;
    this.badge = undefined;
    this.lastTestAt = -Infinity;
    /** The command in flight (one at a time for the account). */
    this.inFlight = undefined;
    /** No new command before this time: a write left just before. */
    this.quietUntil = -Infinity;
    /** `${module}:${zone}:${role}` -> { from, expected, moved, until }: a command sent, not seen yet. */
    this.guards = new Map();
    /** Increases at every write that may have left: a read begun before it is dropped. */
    this.writes = 0;
  }

  // --- Lifecycle -------------------------------------------------------------

  freshAccount(config) {
    return {
      client: new RothClient({
        email: config.email,
        password: config.password,
        now: this.now,
        mayLogin: () => this.mayLogin(),
        onLogin: () => this.loggedIn(),
        ...(this.request ? { request: this.request } : {}),
      }),
      /** The modules of the account (src/model.js modulesOf), and when they were listed. */
      modules: undefined,
      modulesAt: -Infinity,
      /** moduleId -> { zones: Map(zoneId -> zone), schedules, complete } of the last read. */
      data: new Map(),
      online: undefined,
      failures: 0,
      wait: undefined,
      /** 'auth', 'busy', 'signIn', or a short reason. */
      error: undefined,
      timer: undefined,
      running: undefined,
      followUps: new Set(),
    };
  }

  async loadMemory() {
    if (this.memoryLoaded) {
      return;
    }
    this.memoryLoaded = true;
    const raw = await this.store.load().catch(() => null);
    this.memory = normalizeMemory(raw, this.now());
  }

  saveMemory() {
    return this.store.save(serializeMemory(this.memory)).catch((err) => {
      if (!this.saveWarned) {
        this.saveWarned = true;
        this.logger.warn(`The state could not be saved in /data: ${err?.code ?? 'error'}`);
      }
    });
  }

  /** Never two sign-ins within a minute (persisted: a restart counts too). */
  mayLogin() {
    return this.now() - this.memory.lastLoginAt >= TIMINGS.loginFloor;
  }

  /** A sign-in is about to leave: its time is on disk first (a crash right after counts). */
  loggedIn() {
    this.memory.lastLoginAt = this.now();
    return this.saveMemory();
  }

  async start(raw = {}) {
    const previous = this.account;
    this.stop();
    await previous?.running;
    await this.loadMemory();
    this.config = normalizeConfig(raw);
    this.account = this.config.problem ? undefined : this.freshAccount(this.config);
    // The roles are those this account reports from now on (the created
    // features are kept anyway by keepCreatedFeatures).
    this.seen.clear();
    this.published = undefined;
    this.badge = undefined;
    this.lastStatus = undefined;
    this.publisher.start();
    if (!this.account) {
      // The devices already created are shown unreachable.
      await this.publishAll();
      return;
    }
    await this.setStatus(false, T.connecting);
    await this.tick();
  }

  stop() {
    this.generation += 1;
    if (this.account) {
      this.clearTimer();
      for (const handle of this.account.followUps) {
        this.timers.clearTimeout(handle);
      }
      this.account.followUps.clear();
      this.account.client.close();
    }
    this.publisher.stop();
  }

  clearTimer() {
    if (this.account?.timer) {
      this.timers.clearTimeout(this.account.timer);
      this.account.timer = undefined;
    }
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (status, Discovery
   * list, badges) and the last states. The client, its token, the pause and
   * the stop on refused credentials stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    const next = normalizeConfig(raw);
    if (
      next.pollInterval !== this.config.pollInterval ||
      connectionKey(next) !== connectionKey(this.config)
    ) {
      await this.configUpdated(raw);
      return;
    }
    this.config = next;
    this.published = undefined;
    this.badge = undefined;
    this.lastStatus = undefined;
    this.gladys.forgetPublishedStates?.();
    await this.publishAll();
  }

  /**
   * Saved by the user. Other credentials lift the stop on refused
   * credentials (never the minute between two sign-ins, nor a pause). The
   * options, the ceiling and the language apply at once.
   */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    if (connectionKey(next) !== connectionKey(this.config)) {
      this.memory.auth = { failures: 0, until: 0 };
      await this.saveMemory();
      await this.start(raw);
      return;
    }
    const previous = this.config;
    this.config = next;
    if (next.pollInterval !== previous.pollInterval && this.account && !this.account.running) {
      // Only the interval: the account, its client and its token stay; the
      // next read follows the new interval (a backoff or a pause still holds).
      this.schedule();
    }
    if (
      next.allowSetpoints !== previous.allowSetpoints ||
      next.allowPrograms !== previous.allowPrograms
    ) {
      this.logger.info(
        `Touchline SL commands: setpoints ${next.allowSetpoints ? 'allowed' : 'off'}, programs ${next.allowPrograms ? 'allowed' : 'off'}`,
      );
    }
    if (next.language !== previous.language) {
      this.published = undefined;
      await this.publishAll();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys.setConnectionStatus(connected, message).catch((err) => {
      this.lastStatus = undefined;
      this.logger.warn(`setConnectionStatus failed: ${err.message}`);
    });
  }

  // --- Polling ---------------------------------------------------------------

  get interval() {
    return this.config.pollInterval * SECOND;
  }

  /** The end of a pause (429/5xx) or of the stop on refused credentials, else 0. */
  blockedUntil() {
    const until = Math.max(this.memory.pausedUntil, this.memory.auth.until);
    return until > this.now() ? until : 0;
  }

  /** The next read: after a backoff when the last one failed, else the interval. */
  schedule() {
    const account = this.account;
    this.clearTimer();
    const base = account.online === false ? (account.wait ?? this.interval) : this.interval;
    const blocked = this.blockedUntil() - this.now();
    const wait = Math.max(base, blocked, 0);
    const generation = this.generation;
    account.timer = this.timers.setTimeout(() => {
      account.timer = undefined;
      if (generation === this.generation) {
        this.tick().catch(() => this.logger.error('Touchline SL refresh failed'));
      }
    }, wait);
  }

  /** One read at a time: a tick during a read joins it. `force`: the user asked. */
  tick({ force = false } = {}) {
    const account = this.account;
    if (!account) {
      return Promise.resolve();
    }
    if (!account.running) {
      account.running = this.run(account, { force }).finally(() => {
        account.running = undefined;
      });
    }
    return account.running;
  }

  async run(account, { force }) {
    const generation = this.generation;
    const now = this.now();
    if (this.memory.pausedUntil > now) {
      this.halted(account, 'busy', this.memory.pausedUntil - now);
    } else if (this.memory.auth.until > now && !force) {
      this.halted(account, 'auth', this.memory.auth.until - now);
    } else {
      try {
        await this.read(account, generation);
      } catch (err) {
        if (generation !== this.generation) {
          return;
        }
        this.failed(account, err);
      }
    }
    if (generation !== this.generation) {
      return;
    }
    await this.publishAll();
    if (generation === this.generation) {
      this.schedule();
    }
  }

  /** Nothing requested: a pause or a stop holds. */
  halted(account, error, wait) {
    account.online = false;
    account.error = error;
    account.wait = wait;
  }

  async read(account, generation) {
    const { client } = account;
    const writes = this.writes;
    if (!account.modules || this.now() - account.modulesAt >= TIMINGS.modulesInterval) {
      try {
        const modules = modulesOf(await client.modules());
        if (!modules) {
          throw new RothError(CODES.BAD_ANSWER, { sent: true });
        }
        account.modules = modules;
        account.modulesAt = this.now();
      } catch (err) {
        // A list that fails while the modules are known never stops their reads.
        const fatal = isAuthRefused(err) || isBusy(err) || err.code === CODES.NO_SESSION;
        if (!account.modules || fatal) {
          throw err;
        }
        this.logger.warn(`Touchline SL: the list of controllers failed (${reasonOf(err)})`);
        account.modulesAt = this.now() - TIMINGS.modulesInterval + TIMINGS.backoff.at(-1);
      }
    }
    if (generation !== this.generation) {
      return;
    }
    const fresh = new Map();
    for (const module of account.modules) {
      let parsed;
      try {
        parsed = moduleOf(await client.module(module.id));
      } catch (err) {
        if (err.code === CODES.HTTP && err.status === 404) {
          // No longer on the account: listed again at the next read.
          account.modulesAt = -Infinity;
          continue;
        }
        throw err;
      }
      if (generation !== this.generation) {
        return;
      }
      if (!parsed) {
        throw new RothError(CODES.BAD_ANSWER, { sent: true });
      }
      fresh.set(module.id, {
        zones: new Map(parsed.zones.map((z) => [z.id, z])),
        schedules: parsed.schedules,
        complete: parsed.complete,
      });
    }
    if (this.writes === writes) {
      account.data = fresh;
    } else {
      // A command wrote meanwhile: this read may predate it; the follow-ups read again.
      for (const [id, entry] of fresh) {
        if (!account.data.has(id)) {
          account.data.set(id, entry);
        }
      }
    }
    account.online = true;
    account.failures = 0;
    account.wait = undefined;
    account.error = undefined;
    if (this.memory.auth.failures > 0 || this.memory.auth.until > 0) {
      this.memory.auth = { failures: 0, until: 0 };
      await this.saveMemory();
    }
    this.observe(account);
  }

  /**
   * A refusal of the credentials or a 429/5xx, met by any request: the stop
   * or the pause, persisted. Returns the wait, or undefined for any other error.
   */
  block(err) {
    const now = this.now();
    if (isAuthRefused(err)) {
      const { failures } = this.memory.auth;
      const wait = TIMINGS.authRetry[Math.min(failures, TIMINGS.authRetry.length - 1)];
      this.memory.auth = { failures: failures + 1, until: now + wait };
      void this.saveMemory();
      this.logger.warn(
        `Roth refused the credentials (HTTP ${err.status ?? '?'}): next try in ${Math.round(wait / 60_000)} min`,
      );
      return { kind: 'auth', wait };
    }
    if (isBusy(err)) {
      const step =
        TIMINGS.backoff[Math.min(this.account?.failures ?? 0, TIMINGS.backoff.length - 1)];
      const wait = Math.min(
        TIMINGS.pauseMax,
        Math.max(TIMINGS.pauseMin, this.interval, err.retryAfterMs ?? step),
      );
      this.memory.pausedUntil = Math.max(this.memory.pausedUntil, now + wait);
      void this.saveMemory();
      this.logger.warn(`Roth busy (HTTP ${err.status}): paused for ${Math.round(wait / 1000)} s`);
      return { kind: 'busy', wait };
    }
    return undefined;
  }

  failed(account, err) {
    account.online = false;
    const blocked = this.block(err);
    if (blocked) {
      account.error = blocked.kind;
      account.wait = blocked.wait;
      account.failures += 1;
      return;
    }
    if (err.code === CODES.NO_SESSION) {
      // A sign-in left less than a minute ago: the next one as soon as the
      // minute is over (nothing was read: no read is repeated sooner).
      account.error = 'signIn';
      account.wait = Math.max(SECOND, this.memory.lastLoginAt + TIMINGS.loginFloor - this.now());
      return;
    }
    const reason = reasonOf(err);
    // Never read again sooner than the interval.
    const wait = Math.max(
      this.interval,
      TIMINGS.backoff[Math.min(account.failures, TIMINGS.backoff.length - 1)],
    );
    account.failures += 1;
    account.wait = wait;
    account.error = reason;
    this.logger.warn(`Touchline SL: ${reason}; next try in ${Math.round(wait / 1000)} s`);
  }

  // --- What the account gives -------------------------------------------------

  /** Whether the values of the last read are current. */
  get live() {
    return Boolean(this.account?.online === true && this.account.modules);
  }

  createdDevice(externalId) {
    return (this.gladys.devices ?? []).find((d) => d?.external_id === externalId);
  }

  /** Our created devices: [{ device, moduleId, zoneId }]. */
  ourDevices() {
    const list = [];
    for (const device of this.gladys.devices ?? []) {
      const key = parseDeviceId(device?.external_id);
      if (key && deviceIds(this.gladys, key.moduleId, key.zoneId).device === device.external_id) {
        list.push({ device, ...key });
      }
    }
    return list;
  }

  zoneOf(moduleId, zoneId) {
    return this.account?.data.get(moduleId)?.zones.get(zoneId);
  }

  /**
   * How a created zone stands: 'online', 'offline' (Roth does not answer) or
   * 'gone' (no longer on the account). undefined while a first read is under way.
   */
  standing(moduleId, zoneId) {
    if (this.live) {
      return this.zoneOf(moduleId, zoneId) ? 'online' : 'gone';
    }
    if (!this.account || this.account.online === false) {
      return 'offline';
    }
    return undefined;
  }

  /** The roles of a zone: those seen during this run, plus those the last read reports. */
  rolesFor(moduleId, zoneId) {
    const key = zoneKeyOf(moduleId, zoneId);
    const seen = this.seen.get(key) ?? new Set();
    const zone = this.live ? this.zoneOf(moduleId, zoneId) : undefined;
    if (zone) {
      for (const role of reportedRoles(zone)) {
        seen.add(role);
      }
    }
    this.seen.set(key, seen);
    return seen;
  }

  // --- Gladys ----------------------------------------------------------------

  async publishAll() {
    await this.publishDevices();
    this.queueStates();
    await this.flush();
    await this.publishBadge();
    await this.updateStatus();
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  /**
   * The Discovery list: the active zones of the last read, and the devices
   * already created (even unreachable now, or gone), as they are.
   */
  async publishDevices() {
    const keys = new Map();
    for (const [moduleId, entry] of this.account?.data ?? []) {
      for (const zone of entry.zones.values()) {
        if (isActive(zone)) {
          keys.set(zoneKeyOf(moduleId, zone.id), { moduleId, zoneId: zone.id });
        }
      }
    }
    for (const { moduleId, zoneId } of this.ourDevices()) {
      keys.set(zoneKeyOf(moduleId, zoneId), { moduleId, zoneId });
    }
    const devices = [...keys.values()]
      .map(({ moduleId, zoneId }) => {
        const entry = this.account?.data.get(moduleId);
        return buildDevice(
          this.gladys,
          { moduleId, zoneId },
          {
            roles: this.rolesFor(moduleId, zoneId),
            zone: entry?.zones.get(zoneId),
            module: this.account?.modules?.find((m) => m.id === moduleId),
            schedules: entry?.schedules,
            language: this.config.language,
            created: this.createdDevice(deviceIds(this.gladys, moduleId, zoneId).device),
          },
        );
      })
      // Never a device without a feature.
      .filter((d) => d.features.length > 0);
    if (devices.length === 0) {
      return;
    }
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  queueStates(created = this.createdFeatures()) {
    for (const { moduleId, zoneId } of this.ourDevices()) {
      const status = this.standing(moduleId, zoneId);
      if (status === undefined) {
        continue;
      }
      const ids = deviceIds(this.gladys, moduleId, zoneId);
      const online = status === 'online';
      const states = deviceStates(ids, online ? this.zoneOf(moduleId, zoneId) : undefined, {
        status,
        schedules: online ? this.account.data.get(moduleId).schedules : [],
        language: this.config.language,
      });
      for (const { device_feature_external_id: id, ...value } of states) {
        if (created.has(id)) {
          this.publisher.push(id, value);
        }
      }
    }
  }

  async publishBadge() {
    const entries = [];
    for (const { device, moduleId, zoneId } of this.ourDevices()) {
      const status = this.standing(moduleId, zoneId);
      if (status === undefined) {
        continue;
      }
      entries.push({
        external_id: device.external_id,
        transport: status === 'online' ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE,
      });
    }
    const json = JSON.stringify(entries);
    if (entries.length === 0 || json === this.badge) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      this.badge = json;
    } catch (err) {
      this.logger.warn(`Transport badge failed: ${err.message}`);
    }
  }

  /** The connection status of the configuration screen. */
  async updateStatus() {
    const [connected, message] = this.status();
    await this.setStatus(connected, message);
  }

  status() {
    const account = this.account;
    if (!account) {
      return [false, T.problem(this.config.problem)];
    }
    if (account.online === false) {
      const wait = age(account.wait ?? this.interval);
      switch (account.error) {
        case 'auth':
          return [false, T.authRefused(wait)];
        case 'busy':
          return [false, T.busy(wait)];
        case 'signIn':
          return [false, T.signInWait(wait)];
        default:
          return [false, T.unreachable(account.error ?? 'error', wait)];
      }
    }
    if (!this.live) {
      return [false, T.connecting];
    }
    if (account.modules.length === 0) {
      return [true, T.noModule];
    }
    let zones = 0;
    for (const entry of account.data.values()) {
      for (const zone of entry.zones.values()) {
        zones += isActive(zone) ? 1 : 0;
      }
    }
    return [true, T.connected(account.modules.length, zones)];
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.badge = undefined;
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueStates(created);
    await this.flush();
    await this.publishBadge();
    await this.updateStatus();
  }

  async deviceDeleted(device) {
    this.badge = undefined;
    if (typeof device?.external_id === 'string') {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the controllers listed again at the next read. */
  async scan() {
    if (this.account) {
      this.account.modulesAt = -Infinity;
    }
    this.published = undefined;
    await this.publishDevices();
  }

  // --- Configuration button --------------------------------------------------

  /** Reads now (even after refused credentials: the user asked), at most every 10 s. */
  async testConnection() {
    if (!this.account) {
      return this.status()[1];
    }
    if (this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const last = JSON.parse(this.lastStatus ?? '[false,null]')[1];
      return last ? T.join(T.test.cooldown, last) : T.test.cooldown;
    }
    this.lastTestAt = this.now();
    // A pause (429/5xx) and the minute between two sign-ins hold even for
    // the button; a read in progress is joined. Gladys waits 30 s for the
    // button: the answer comes by 25 s.
    let handle;
    const limit = new Promise((resolve) => {
      handle = this.timers.setTimeout(resolve, TIMINGS.testBudget);
    });
    await Promise.race([this.tick({ force: true }), limit]);
    this.timers.clearTimeout(handle);
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? T.connecting;
  }

  // --- The commands --------------------------------------------------------------

  refusal(text) {
    return new Error(word(text, this.config.language));
  }

  /** The option of a role, read now. */
  allowed(role) {
    return role === F.TARGET ? this.config.allowSetpoints : this.config.allowPrograms;
  }

  /** The bounds of a setpoint, in tenths of °C: 5 °C to the configured ceiling. */
  bounds() {
    return { low: SETPOINT.min * 10, high: Math.min(SETPOINT.max, this.config.ceiling) * 10 };
  }

  /**
   * The value of a command, checked strictly (null, '' or 'abc' are not a
   * number; a program is one of the exact option values), within the bounds.
   */
  parseCommand(role, value) {
    if (role === F.PROGRAM) {
      if (typeof value !== 'string') {
        throw this.refusal(ERRORS.badProgram);
      }
      if (value === CONSTANT) {
        return { program: CONSTANT };
      }
      const match = /^schedule-(\d{1,4})$/.exec(value);
      if (!match) {
        throw this.refusal(ERRORS.badProgram);
      }
      return { program: value, index: Number(match[1]) };
    }
    const number = numberOf(value);
    if (number === undefined) {
      throw this.refusal(ERRORS.badNumber);
    }
    if (Math.abs(number * 10 - Math.round(number * 10)) > 1e-6) {
      throw this.refusal(ERRORS.badStep);
    }
    const tenths = Math.round(number * 10);
    this.checkBounds(tenths);
    return { tenths };
  }

  checkBounds(tenths) {
    const { low, high } = this.bounds();
    if (tenths < low || tenths > high) {
      throw this.refusal(ERRORS.outOfRange(low / 10, high / 10));
    }
  }

  async setValue(_device, feature, value) {
    // The deadlines count from the arrival of the command, before any wait.
    const received = this.now();
    const target = parseFeatureId(feature?.external_id);
    if (!target || !COMMAND_ROLES.includes(target.role)) {
      throw this.refusal(ERRORS.readOnly);
    }
    if (!this.allowed(target.role)) {
      throw this.refusal(
        target.role === F.TARGET ? ERRORS.setpointsDisabled : ERRORS.programsDisabled,
      );
    }
    const wanted = this.parseCommand(target.role, value);
    if (this.inFlight || received < this.quietUntil) {
      throw this.refusal(ERRORS.stillRunning);
    }
    const promise = this.command(target, wanted, received);
    this.inFlight = promise;
    try {
      return await promise;
    } finally {
      if (this.inFlight === promise) {
        this.inFlight = undefined;
      }
    }
  }

  /** The checks before sending, on the latest configuration and state. */
  checkBeforeSend(generation, account, { role }, temps) {
    if (!this.allowed(role)) {
      throw this.refusal(role === F.TARGET ? ERRORS.setpointsDisabled : ERRORS.programsDisabled);
    }
    if (this.blockedUntil() > 0) {
      throw this.refusal(ERRORS.paused);
    }
    if (generation !== this.generation || this.account !== account || !this.live) {
      throw this.refusal(ERRORS.unknownDevice);
    }
    if (!account.client.hasSession) {
      throw this.refusal(ERRORS.noSession);
    }
    // The ceiling may have been lowered since the command arrived: every
    // temperature the command would set (a setpoint, the setpoint kept by
    // "constant", all those of a program) is checked again.
    const { low, high } = this.bounds();
    if (temps.some((t) => t < low || t > high)) {
      throw this.refusal(
        role === F.TARGET
          ? ERRORS.outOfRange(low / 10, high / 10)
          : ERRORS.programOutOfRange(low / 10, high / 10),
      );
    }
  }

  async command(target, wanted, received) {
    const generation = this.generation;
    const account = this.account;
    const sendBy = received + TIMINGS.commandSendBy;
    this.checkBeforeSend(
      generation,
      account,
      target,
      wanted.tenths === undefined ? [] : [wanted.tenths],
    );
    const { moduleId, zoneId, role } = target;
    if (!account.data.get(moduleId)?.zones.has(zoneId)) {
      throw this.refusal(ERRORS.unknownDevice);
    }
    const readBy = Math.min(this.now() + TIMINGS.commandReadMax, sendBy - TIMINGS.commandMinSend);
    if (readBy - this.now() < TIMINGS.commandMinRead) {
      throw this.refusal(ERRORS.tooSlow);
    }
    // The fresh read: the zone and its controller now, never the values in memory.
    let parsed;
    try {
      parsed = moduleOf(await account.client.freshModule(moduleId, { answerBy: readBy }));
    } catch (err) {
      if (!(err instanceof RothError)) {
        throw err;
      }
      if (err.code === CODES.LATE || err.code === CODES.TIMEOUT) {
        throw this.refusal(ERRORS.tooSlow);
      }
      if (err.code === CODES.NO_SESSION || (err.code === CODES.HTTP && err.status === 401)) {
        // The token is renewed by the next poll, on its own schedule (never
        // twice a minute): no sign-in fits in the time of a command.
        throw this.refusal(ERRORS.noSession);
      }
      this.block(err);
      throw this.refusal(ERRORS.unknownState(reasonOf(err)));
    }
    if (!parsed) {
      throw this.refusal(ERRORS.missingValue);
    }
    const zone = parsed.zones.find((z) => z.id === zoneId);
    if (!zone) {
      throw this.refusal(ERRORS.unknownDevice);
    }
    if (zone.state === undefined || zone.algorithm === undefined) {
      throw this.refusal(ERRORS.missingValue);
    }
    if (!isActive(zone)) {
      throw this.refusal(ERRORS.zoneOff);
    }
    if (zone.algorithm !== 'heating') {
      throw this.refusal(ERRORS.cooling);
    }
    if (zone.mode.id === undefined || zone.mode.name === undefined) {
      throw this.refusal(ERRORS.missingValue);
    }
    const plan = this.planOf(role, wanted, zone, parsed, moduleId);
    const key = `${zoneKeyOf(moduleId, zoneId)}:${role}`;
    const current = comparable(role, zone);
    if (current === undefined) {
      throw this.refusal(ERRORS.missingValue);
    }
    if (current === plan.expected && !this.guardActive(key)) {
      // Already so: nothing sent.
      return;
    }
    // The options may have been turned off during the read: checked again.
    this.checkBeforeSend(generation, account, target, plan.temps);
    if (this.now() > sendBy) {
      throw this.refusal(ERRORS.tooSlow);
    }
    this.logger.info(`Touchline SL ${role}: ${plan.log}`);
    const options = {
      startBy: sendBy,
      answerBy: received + TIMINGS.commandAnswerBy,
      // The very last check, right before the request leaves.
      beforeSend: () => this.checkBeforeSend(generation, account, target, plan.temps),
    };
    try {
      await plan.send(account.client, options);
    } catch (err) {
      if (err.beforeSend) {
        throw err;
      }
      const reason = reasonOf(err);
      this.logger.warn(`Touchline SL ${role}: ${plan.log} failed (${reason})`);
      if (!err.sent) {
        // Nothing reached Roth.
        throw this.refusal(err.code === CODES.LATE ? ERRORS.tooSlow : ERRORS.notSent(reason));
      }
      if (err.code === CODES.HTTP && err.status >= 400 && err.status <= 499) {
        // Refused by Roth (token, request, rate): not applied.
        this.block(err);
        this.followUp(account);
        throw this.refusal(ERRORS.refused(reason));
      }
      // A silence, a dropped connection, a 5xx: the write may have reached Roth.
      this.block(err);
      this.guard(key, { from: current, expected: plan.expected });
      this.followUp(account);
      throw this.refusal(ERRORS.sentUnconfirmed(reason));
    }
    this.guard(key, { from: current, expected: plan.expected });
    this.followUp(account);
  }

  /**
   * What a command sends, decided on the fresh read: `expected` (what a read
   * shows once it is applied), `send(client, options)` and a log text.
   */
  planOf(role, wanted, zone, parsed, moduleId) {
    const modeId = zone.mode.id;
    const constant = (tenths) => ({
      expected: role === F.TARGET ? `constantTemp:${tenths}` : CONSTANT,
      temps: [tenths],
      log: `${tenths / 10} °C`,
      send: (client, options) =>
        client.setZoneTemperature({ moduleId, modeId, zoneId: zone.id, tenths }, options),
    });
    if (role === F.TARGET) {
      return constant(wanted.tenths);
    }
    if (wanted.program === CONSTANT) {
      // The constant mode keeps the setpoint the zone has now, within the bounds.
      if (zone.targetTenths === undefined) {
        throw this.refusal(ERRORS.missingValue);
      }
      this.checkBounds(zone.targetTenths);
      return constant(zone.targetTenths);
    }
    const schedule = parsed.schedules.find((s) => s.index === wanted.index);
    if (!schedule) {
      throw this.refusal(ERRORS.programMissing);
    }
    if (!schedule.complete || !parsed.complete) {
      throw this.refusal(ERRORS.programIncomplete);
    }
    const { low, high } = this.bounds();
    if (schedule.temps.some((t) => t < low || t > high)) {
      throw this.refusal(ERRORS.programOutOfRange(low / 10, high / 10));
    }
    // The zones already on this program, and this one (pytouchlinesl
    // set_zone_schedule): Roth takes the whole program back.
    const zones = parsed.zones.filter(
      (z) =>
        (z.mode.name === 'globalSchedule' && z.mode.scheduleIndex === schedule.index) ||
        z.id === zone.id,
    );
    if (zones.some((z) => z.mode.id === undefined)) {
      throw this.refusal(ERRORS.missingValue);
    }
    const payload = {
      scheduleName: schedule.sendName,
      setInZones: zones.map((z) => ({ zoneId: z.id, modeId: z.mode.id })),
      schedule: schedule.body,
    };
    return {
      expected: scheduleOption(schedule.index),
      temps: schedule.temps,
      log: `program ${schedule.index}`,
      send: (client, options) =>
        client.setZoneSchedule({ moduleId, zoneId: zone.id, payload }, options),
    };
  }

  /** Reads after a command, spaced: its effect, then a check. */
  followUp(account) {
    const generation = this.generation;
    this.writes += 1;
    // A write may have left: the next command waits a little, so that two
    // settings are never written back to back.
    this.quietUntil = this.now() + TIMINGS.commandSpacing;
    for (const delay of TIMINGS.followUps) {
      const handle = this.timers.setTimeout(() => {
        account.followUps.delete(handle);
        // Never sooner than the backoff: an account that stopped answering
        // is read again on its own schedule only.
        if (generation === this.generation && this.account?.online !== false) {
          this.tick().catch(() => this.logger.error('Touchline SL refresh failed'));
        }
      }, delay);
      account.followUps.add(handle);
    }
  }

  // --- Guards ----------------------------------------------------------------------

  /**
   * After a command, until a read shows it: a new command is always sent,
   * never answered "already so" on a value that may not show the previous
   * one yet. The start value is kept: a read equal to it lifts nothing
   * until a move was seen.
   */
  guard(key, plan) {
    this.guards.set(key, { ...plan, moved: false, until: this.now() + TIMINGS.guard });
  }

  guardActive(key) {
    const guard = this.guards.get(key);
    if (guard && this.now() >= guard.until) {
      this.guards.delete(key);
      return false;
    }
    return Boolean(guard);
  }

  /** A read, through the guards: never lifted on an unknown value. */
  observe(account) {
    for (const [key, guard] of [...this.guards]) {
      if (!this.guardActive(key)) {
        continue;
      }
      const match = /^(.+):(\d+):([a-z-]+)$/.exec(key);
      const zone = match ? account.data.get(match[1])?.zones.get(Number(match[2])) : undefined;
      const value = zone ? comparable(match[3], zone) : undefined;
      if (value === undefined) {
        continue;
      }
      if (value !== guard.from) {
        guard.moved = true;
      }
      if (guard.moved && value === guard.expected) {
        this.guards.delete(key);
      }
    }
  }
}
