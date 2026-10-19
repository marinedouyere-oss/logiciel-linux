# Anti-démarchage — filtre d'appels pour montre Wear OS

Appli **Wear OS** (Galaxy Watch4 et suivantes, Pixel Watch…) qui bloque les
appels de démarchage directement sur une montre **eSIM autonome**, sans
téléphone associé. Elle reprend le principe de **Prefixtel** : bloquer les
préfixes que l'ARCEP réserve aux plateformes d'appels automatisés.

## Fonctionnalités

- **Liste ARCEP** (activée par défaut) : les 17 préfixes réservés au
  démarchage par la décision ARCEP n° 2022-1583 (en vigueur depuis le
  1er janvier 2023) :
  - métropole : 01 62, 01 63, 02 70, 02 71, 03 77, 03 78, 04 24, 04 25,
    05 68, 05 69, 09 48, 09 49 ;
  - outre-mer : 09 475 (Guadeloupe, St-Martin, St-Barth), 09 476 (Guyane),
    09 477 (Martinique), 09 478 et 09 479 (La Réunion, Mayotte).
- **Mes préfixes** : ajout de préfixes perso au clavier ou à la voix
  (`0899`, `+44`…). Tout numéro qui commence ainsi est bloqué.
- **Numéros masqués** : option pour bloquer aussi les appels sans numéro.
- **Appels bloqués** : journal des 100 derniers appels bloqués (numéro,
  date, préfixe en cause).

Les numéros sont reconnus quelle que soit leur présentation : `01 62…`,
`+33 1 62…`, `0033 1 62…`, `+33 (0)1 62…`.

## Comment la montre bloque

L'appli choisit automatiquement la meilleure méthode disponible :

1. **Filtrage avant sonnerie** (méthode de Prefixtel) : l'appli devient le
   « filtre d'appels » d'Android. Chaque appel lui est soumis avant que la
   montre sonne, et les appels de démarchage sont rejetés sans sonnerie ni
   notification.
2. **Mode secours**, si la montre ne propose pas le rôle « filtre
   d'appels » : l'appli raccroche dès que l'appel arrive. La montre peut
   vibrer une fraction de seconde, et les numéros masqués ne peuvent pas
   être reconnus dans ce mode.

L'écran d'accueil affiche le mode en cours (« Avant la sonnerie » ou
« Mode secours »).

## Installation sur la montre (sans téléphone)

Il faut un ordinateur avec `adb` (sous Linux : `sudo apt install adb`), sur le
même Wi-Fi que la montre.

1. **Activer les options de développement** sur la montre :
   - Galaxy Watch : *Paramètres > À propos de la montre > Informations
     logicielles*, touchez 5 fois *Version du logiciel* ;
   - Pixel Watch : *Paramètres > Système > À propos > Versions*, touchez 7
     fois *Numéro de build*.
2. Dans *Paramètres > Options de développement*, activez **Débogage ADB**
   puis **Débogage sans fil**. Touchez *Associer un nouvel appareil* : la
   montre affiche une adresse `IP:port` et un code.
3. Sur l'ordinateur :

   ```bash
   adb pair IP:PORT_ASSOCIATION        # saisir le code affiché
   adb connect IP:PORT_DEBOGAGE        # adresse de l'écran « Débogage sans fil »
   adb install app-release.apk
   ```

4. Ouvrez **Anti-démarchage** sur la montre et touchez **Activer la
   protection** : acceptez de choisir l'appli comme filtre d'appels, ou, en
   mode secours, autorisez l'accès au téléphone et au journal d'appels.

Vous pouvez ensuite désactiver le débogage sans fil.

### Vérifier que le blocage marche

Ajoutez temporairement dans **Mes préfixes** le début du numéro d'un proche
(par ex. `06 12`), demandez-lui de vous appeler, vérifiez que l'appel
apparaît dans **Appels bloqués**, puis retirez le préfixe.

## Compiler l'APK

Prérequis : JDK 17 ou plus récent et le SDK Android (plateforme 35), avec
`ANDROID_HOME` qui pointe vers le SDK.

```bash
./gradlew testDebugUnitTest   # tests du filtre de numéros
./gradlew assembleRelease     # APK : app/build/outputs/apk/release/app-release.apk
```

L'APK de release est signé avec la clé de debug de la machine qui compile.
Pour installer un APK compilé sur une autre machine, désinstallez d'abord
l'ancienne version (`adb uninstall fr.antidemarchage.montre`).

## Limites

- Comme Prefixtel, la liste ARCEP bloque aussi les appels automatisés
  légitimes qui utilisent ces préfixes (rappels de rendez-vous,
  livraisons…).
- L'ARCEP peut faire évoluer la liste : elle se met à jour dans
  `PrefixesArcep` (`app/src/main/java/fr/antidemarchage/montre/FiltreNumeros.kt`).

## Structure du projet

```
app/src/main/java/fr/antidemarchage/montre/
  FiltreNumeros.kt         préfixes ARCEP, normalisation et filtrage des numéros
  Reglages.kt              réglages, préfixes perso et journal (préférences)
  Protection.kt            choix du mode : filtre système ou mode secours
  FiltreAppelsService.kt   filtrage avant sonnerie (CallScreeningService)
  AppelEntrantReceiver.kt  mode secours : raccroche les appels bloqués
  MainActivity.kt          activité, demandes d'autorisation, navigation
  Ecrans.kt                écrans Compose pour Wear OS
app/src/test/              tests unitaires du filtre
```
