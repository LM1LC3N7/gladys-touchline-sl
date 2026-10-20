// -----------------------------------------------------------------------------
// Constants: the Roth API, feature roles, manifest keys, limits and timings.
//
// Roth Touchline SL is an underfloor heating controller (a "module", the
// L-11 / L-12 controller) whose zones (rooms) are read and set through the
// public Roth Touchline SL API (https://roth-touchlinesl.com/api/v1,
// documented at api-documentation.roth-touchlinesl.com), with the e-mail
// address and the password of the Roth account, as pytouchlinesl 0.6.0
// (Apache-2.0, the library of Home Assistant's Touchline SL integration)
// uses it: POST /authentication, GET /users/{user}/modules and
// /users/{user}/modules/{module}, POST .../zones (a constant setpoint) and
// POST .../zones/{zone}/global_schedule (a zone onto a program).
// Temperatures travel in tenths of °C.
// -----------------------------------------------------------------------------

export const ROTH = {
  apiUrl: 'https://roth-touchlinesl.com/api/v1',
};

/** Feature roles (the last part of the feature external ids): frozen. */
export const FEATURES = {
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  TARGET: 'target-temperature',
  OPERATING: 'operating-state',
  PROGRAM: 'program',
  MODE: 'mode',
  STATUS: 'status',
  WINDOW: 'window-open',
  BATTERY: 'battery',
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/** The poll interval of the configuration, in seconds (Home Assistant: 30 s). */
export const POLL_INTERVAL = {
  min: 30,
  max: 600,
  default: 60,
};

/**
 * The setpoints Gladys may send, in °C. A floor heating zone stays within
 * 5–30 °C whatever is typed; the configuration lowers the ceiling (24 °C by
 * default, 16 to 30 °C). A program is assigned only when every temperature
 * it holds lies within the same bounds.
 */
export const SETPOINT = {
  min: 5,
  max: 30,
  ceilingMin: 16,
  ceilingDefault: 24,
};

/** The thermostat operating state of the core (THERMOSTAT_OPERATING_STATE). */
export const OPERATING_STATE = { IDLE: 0, HEATING: 1, COOLING: 2 };

/** The option value of the "constant temperature" mode in the program select. */
export const CONSTANT = 'constant';

export const LIMITS = {
  /** Gladys: 300 states per minute; a margin is kept. */
  statesPerMinute: 250,
  statesPerRequest: 100,
  /** An answer of Roth is read up to this size, then dropped (a module: ~100 KB). */
  responseBytes: 2 * 1024 * 1024,
  /** What one account may hold: more is ignored. */
  modules: 8,
  zones: 64,
  schedules: 16,
  /** Names (modules, zones, programs) are cut to this length. */
  nameLength: 60,
  /** A token longer than this is refused. */
  tokenLength: 4096,
  /** Token renewals after a 401 without any read going through: then a stop. */
  renewalsWithoutRead: 3,
};

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** One request of the polling. */
  requestTimeout: 15 * SECOND,
  /** The list of modules: at start, on a scan, then every 6 hours. */
  modulesInterval: 6 * HOUR,
  /** Never two sign-ins within a minute, even across a restart (persisted). */
  loginFloor: MINUTE,
  /** Failed polls: 30 s, 1, 2, then 5 minutes, never shorter than the interval. */
  backoff: [30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE],
  /** An HTTP 429 or 5xx: a pause of 1 min to 6 h, persisted in /data. */
  pauseMin: MINUTE,
  pauseMax: 6 * HOUR,
  /** Credentials refused: next tries 15 min, 1 h, 6 h, then every 24 h. */
  authRetry: [15 * MINUTE, HOUR, 6 * HOUR, 24 * HOUR],
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /** The "Test the connection" button reads at most this often. */
  testCooldown: 10 * SECOND,
  /** The button waits 30 s in Gladys: it answers by 25 s, the read going on if longer. */
  testBudget: 25 * SECOND,
  /**
   * Commands (Gladys waits 5 s for the ack): the fresh read and the write
   * must leave by 3.5 s after the click, or the command is refused unsent;
   * the answer is awaited until 4.3 s, after which the command is "sent,
   * without confirmation".
   */
  commandSendBy: 3_500,
  commandAnswerBy: 4_300,
  /** The fresh read of a command: 2.5 s at most, and 0.3 s left to send after it. */
  commandReadMax: 2_500,
  commandMinRead: 300,
  commandMinSend: 300,
  /** After a write that may have left, the next command waits this long. */
  commandSpacing: 3 * SECOND,
  /** Reads after a command, spaced: its effect, then a check. */
  followUps: [5 * SECOND, 20 * SECOND],
  /** A sent command keeps its guard until a read shows what it asked, or 90 s. */
  guard: 90 * SECOND,
};
