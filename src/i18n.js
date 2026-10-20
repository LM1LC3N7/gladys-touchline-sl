// -----------------------------------------------------------------------------
// Runtime texts (English and French): feature names, the status of the
// integration, the answers of the button and the command errors. None of
// them ever carries the e-mail address, the password or the token.
// -----------------------------------------------------------------------------

import { FEATURES as F } from './constants.js';

const both = (en, fr) => ({ en, fr });

/** One language of a `{ en, fr }` text. */
export const word = (value, language) => (language === 'en' ? value.en : value.fr);

/** "45 s", "5 min", "2 h", in both languages. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

const join = (...parts) => both(parts.map((p) => p.en).join(' '), parts.map((p) => p.fr).join(' '));

/** The name of the device of a zone. */
export const deviceName = (zoneName, zoneId) =>
  both(
    `${zoneName ?? `Zone ${zoneId}`} (Touchline SL)`,
    `${zoneName ?? `Zone ${zoneId}`} (Touchline SL)`,
  );

export const FEATURE_NAMES = {
  [F.TEMPERATURE]: both('Temperature', 'Température'),
  [F.HUMIDITY]: both('Humidity', 'Humidité'),
  [F.TARGET]: both('Setpoint', 'Consigne'),
  [F.OPERATING]: both('Heating running', 'Chauffe en cours'),
  [F.PROGRAM]: both('Program', 'Programme'),
  [F.MODE]: both('Mode (read)', 'Mode (lu)'),
  [F.STATUS]: both('Zone status', 'État de la zone'),
  [F.WINDOW]: both('Window open', 'Fenêtre ouverte'),
  [F.BATTERY]: both('Battery', 'Batterie'),
};

export const CONSTANT_NAME = both('Constant temperature', 'Température constante');

export const MODE_TEXTS = {
  constantTemp: CONSTANT_NAME,
  globalSchedule: (name) => both(`Program "${name}"`, `Programme « ${name} »`),
  localSchedule: both('Own program of the zone', 'Programme propre à la zone'),
  timeLimit: both('Temporary setpoint (time limit)', 'Consigne temporaire (limite de temps)'),
  unknown: both('Unknown mode', 'Mode inconnu'),
};

export const ZONE_STATE_TEXTS = {
  noAlarm: both('OK', 'OK'),
  zoneOff: both('Zone switched off', 'Zone éteinte'),
  zoneUnregistered: both('Zone not registered', 'Zone non enregistrée'),
  sensorDamaged: both('Sensor damaged', 'Capteur endommagé'),
  noCommunication: both('No communication with the sensor', 'Pas de communication avec le capteur'),
  unknown: both('Unknown status', 'État inconnu'),
  offline: both('Roth Touchline SL unreachable', 'Roth Touchline SL injoignable'),
  gone: both('Zone not found on the account', 'Zone introuvable sur le compte'),
};

const PROBLEMS = {
  empty: both(
    'Enter the e-mail address and the password of your Roth Touchline SL account, then save.',
    'Saisissez l’adresse e-mail et le mot de passe de votre compte Roth Touchline SL, puis enregistrez.',
  ),
  noEmail: both(
    'Enter the e-mail address of your Roth account.',
    'Saisissez l’adresse e-mail de votre compte Roth.',
  ),
  badEmail: both('This e-mail address is not valid.', 'Cette adresse e-mail n’est pas valide.'),
  noPassword: both(
    'Enter the password of your Roth account.',
    'Saisissez le mot de passe de votre compte Roth.',
  ),
  badPassword: both('This password is too long.', 'Ce mot de passe est trop long.'),
};

/** The integration status, the button and the logs a user may read. */
export const T = {
  problem: (key) => PROBLEMS[key] ?? PROBLEMS.empty,
  connecting: both('Connecting to Roth Touchline SL…', 'Connexion à Roth Touchline SL…'),
  connected: (modules, zones) =>
    both(
      `Connected: ${modules} controller(s), ${zones} zone(s).`,
      `Connecté : ${modules} régulateur(s), ${zones} zone(s).`,
    ),
  noModule: both(
    'Connected, but the account holds no Touchline SL controller.',
    'Connecté, mais le compte ne contient aucun régulateur Touchline SL.',
  ),
  authRefused: (wait) =>
    join(
      both(
        'Roth refused the e-mail address or the password.',
        'Roth a refusé l’adresse e-mail ou le mot de passe.',
      ),
      both(
        `Next try in ${wait.en}; save other credentials or press "Test the connection" to try now.`,
        `Nouvel essai dans ${wait.fr} ; enregistrez d’autres identifiants ou pressez « Tester la connexion » pour essayer maintenant.`,
      ),
    ),
  busy: (wait) =>
    both(
      `Roth is busy or failing: paused for ${wait.en}.`,
      `Roth est occupé ou en panne : pause de ${wait.fr}.`,
    ),
  signInWait: (wait) =>
    both(
      `Signing in again in ${wait.en} (at most one sign-in per minute).`,
      `Nouvelle connexion dans ${wait.fr} (une connexion par minute au plus).`,
    ),
  unreachable: (reason, wait) =>
    both(
      `Roth Touchline SL unreachable (${reason}): next try in ${wait.en}.`,
      `Roth Touchline SL injoignable (${reason}) : nouvel essai dans ${wait.fr}.`,
    ),
  test: {
    cooldown: both('Tested less than 10 s ago.', 'Testé il y a moins de 10 s.'),
  },
  join,
};

/** The errors of the commands, shown by Gladys when a command fails. */
export const ERRORS = {
  readOnly: both('This feature is read only.', 'Cette fonctionnalité est en lecture seule.'),
  setpointsDisabled: both(
    'Setpoint commands are off: allow them in the configuration of the integration.',
    'Les commandes de consigne sont désactivées : autorisez-les dans la configuration de l’intégration.',
  ),
  programsDisabled: both(
    'Program commands are off: allow them in the configuration of the integration.',
    'Les commandes de programme sont désactivées : autorisez-les dans la configuration de l’intégration.',
  ),
  badNumber: both('Not a temperature.', 'Ce n’est pas une température.'),
  badStep: both('Use steps of 0.1 °C.', 'Utilisez des pas de 0,1 °C.'),
  outOfRange: (min, max) =>
    both(
      `Setpoint refused: from ${min} to ${max} °C only.`,
      `Consigne refusée : de ${min} à ${max} °C seulement.`,
    ),
  badProgram: both('Unknown program.', 'Programme inconnu.'),
  stillRunning: both(
    'Another command is still running: try again in a few seconds.',
    'Une autre commande est en cours : réessayez dans quelques secondes.',
  ),
  paused: both(
    'Roth is paused (busy, failing or credentials refused): command not sent.',
    'Roth est en pause (occupé, en panne ou identifiants refusés) : commande non envoyée.',
  ),
  unknownDevice: both(
    'This zone is not known now: command not sent.',
    'Cette zone n’est pas connue pour l’instant : commande non envoyée.',
  ),
  noSession: both(
    'Signing in to Roth again: command not sent, try again in a minute.',
    'Reconnexion à Roth en cours : commande non envoyée, réessayez dans une minute.',
  ),
  tooSlow: both(
    'Roth answers too slowly: command not sent.',
    'Roth répond trop lentement : commande non envoyée.',
  ),
  unknownState: (reason) =>
    both(
      `The current state could not be read (${reason}): command not sent.`,
      `L’état actuel n’a pas pu être lu (${reason}) : commande non envoyée.`,
    ),
  missingValue: both(
    'A value needed to decide is missing: command not sent.',
    'Une valeur nécessaire pour décider manque : commande non envoyée.',
  ),
  zoneOff: both(
    'This zone is switched off: command not sent.',
    'Cette zone est éteinte : commande non envoyée.',
  ),
  cooling: both(
    'This zone is cooling: read only in this version, command not sent.',
    'Cette zone est en rafraîchissement : lecture seule dans cette version, commande non envoyée.',
  ),
  programMissing: both(
    'This program no longer exists: command not sent.',
    'Ce programme n’existe plus : commande non envoyée.',
  ),
  programIncomplete: both(
    'This program could not be read entirely: command not sent (it must be sent back whole).',
    'Ce programme n’a pas pu être lu entièrement : commande non envoyée (il doit être renvoyé en entier).',
  ),
  programOutOfRange: (min, max) =>
    both(
      `This program asks a temperature outside ${min}–${max} °C: command not sent.`,
      `Ce programme demande une température hors de ${min}–${max} °C : commande non envoyée.`,
    ),
  notSent: (reason) => both(`Command not sent (${reason}).`, `Commande non envoyée (${reason}).`),
  refused: (reason) =>
    both(`Roth refused the command (${reason}).`, `Roth a refusé la commande (${reason}).`),
  sentUnconfirmed: (reason) =>
    both(
      `Command sent, without confirmation (${reason}): check the zone in a moment.`,
      `Commande envoyée, sans confirmation (${reason}) : vérifiez la zone dans un instant.`,
    ),
};
