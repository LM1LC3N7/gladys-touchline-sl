# Roth Touchline SL pour Gladys

Cette intégration affiche les zones (pièces) de votre plancher chauffant
**Roth Touchline SL** dans Gladys, par l'API publique Roth Touchline SL
(le cloud qu'utilise l'application Roth Touchline SL), avec l'adresse e-mail
et le mot de passe de votre compte Roth.

**Jamais testé avec un vrai régulateur ni un vrai compte** : elle suit la
bibliothèque pytouchlinesl (celle de l'intégration Home Assistant), sans
avoir pu être essayée sur une installation réelle. Dites-nous sur le forum
si elle fonctionne chez vous. **Sans lien avec Roth.**

## Ce qu'elle fait

Pour chaque zone allumée de chaque régulateur du compte, un appareil
« Nom de la pièce (Touchline SL) » avec :

- température et humidité de la pièce ;
- consigne (thermostat) ;
- chauffe en cours (repos, chauffe ou rafraîchissement, en lecture seule) ;
- programme (liste : température constante ou l'un des programmes du
  régulateur) et mode lu (« Programme « Salon » », « Température
  constante », « Consigne temporaire »…) ;
- état de la zone (OK, capteur endommagé, pas de communication…) ;
- fenêtre ouverte (si des capteurs de fenêtre sont reliés), batterie du
  thermostat d'ambiance.

Les zones éteintes dans le régulateur ne sont pas proposées.

## Installation

1. Installez l'intégration depuis le store de Gladys.
2. Saisissez l'adresse e-mail et le mot de passe de votre compte Roth
   Touchline SL, puis enregistrez. Le mot de passe est gardé par Gladys dans
   sa base, jamais réaffiché, envoyé seulement à Roth (roth-touchlinesl.com,
   en https).
3. Ouvrez l'onglet **Découverte** et ajoutez les zones voulues.

Le bouton **Tester la connexion** lit Roth une fois et affiche son état.

## Commandes (désactivées par défaut)

Par défaut, Gladys ne fait que lire. Deux options séparées :

- **Autoriser les commandes de consigne** : le tableau de bord, les scènes
  et les assistants vocaux peuvent changer la consigne d'une zone. La zone
  passe alors en température constante (elle quitte son programme, comme
  dans l'application Roth).
- **Autoriser les commandes de programme** : la liste « Programme » peut
  mettre une zone sur l'un des programmes du régulateur, ou en température
  constante (avec la consigne qu'elle a).

Bornes de sécurité :

- une consigne va de 5 °C au **plafond des consignes**, **24 °C par
  défaut**, réglable de 16 à 30 °C, jamais plus de 30 °C ;
- un programme n'est choisi que si **toutes** ses températures restent dans
  ces bornes (sinon la commande est refusée) ;
- le plafond est revérifié juste avant l'envoi : s'il a été baissé
  pendant la commande, rien ne part ;
- un programme mal lu (intervalle à moitié vide, zone au mode illisible)
  n'est jamais renvoyé ;
- une zone en rafraîchissement, éteinte ou inconnue n'est jamais commandée ;
- une zone sur son propre programme ou en consigne temporaire peut être
  mise sur un programme depuis la liste (la liste affiche alors le dernier
  programme lu, le mode lu dit la vérité) ;
- aucune commande ne passe par un interrupteur : un « éteins tout » d'un
  assistant vocal ne touche jamais le chauffage. L'API de Roth n'a pas de
  commande d'arrêt du chauffage.

Chaque commande relit la zone juste avant d'agir et décide sur cette
lecture ; elle part dans les 3,5 s ou est refusée sans rien envoyer. Si
Roth ne répond pas à temps après l'envoi, Gladys affiche « envoyée, sans
confirmation » et relit la zone 5 s et 20 s plus tard. Une commande à la
fois. Pour choisir un programme, Roth demande de renvoyer le programme
entier : l'intégration le renvoie tel qu'elle vient de le lire, sans rien
y changer.

## Limites et sécurité

- Lecture toutes les 60 s (de 30 s à 10 min).
- Identifiants refusés : arrêt gardé dans `/data`, nouvel essai après
  15 min, 1 h, 6 h puis toutes les 24 h, jamais en boucle ; enregistrer
  d'autres identifiants ou presser « Tester la connexion » réessaie.
- Jeton de Roth refusé : une seule nouvelle connexion, jamais deux
  connexions en moins d'une minute (même après un redémarrage) ; un jeton
  refusé juste après une connexion, ou trois renouvellements sans aucune
  lecture réussie, donnent l'arrêt ci-dessus.
- Roth occupé (HTTP 429) ou en panne (5xx) : pause de 1 min à 6 h, gardée
  dans `/data`, pour les lectures comme pour les commandes.
- `/data` ne contient jamais l'adresse e-mail, le mot de passe ni le jeton.
- Une commande ne se connecte jamais à Roth elle-même : si le jeton vient
  d'être refusé, elle répond « réessayez dans une minute ».

## Crédits

L'API de Roth et la forme de ses réponses viennent de
[pytouchlinesl](https://github.com/jnsgruk/pytouchlinesl) (jnsgruk,
Apache-2.0), la bibliothèque de l'intégration Home Assistant. Voir
`THIRD_PARTY_NOTICES.md`.
