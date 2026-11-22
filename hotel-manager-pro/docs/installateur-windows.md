# Installateur Windows : Hotel Manager Pro en local, en un fichier

Un seul fichier, **`HotelManagerPro-Setup-….exe`**, installe tout sur l'ordinateur du client : le logiciel, sa base de données (PostgreSQL) et Node.js. **Rien d'autre à installer**, pas de ligne de commande. Après l'installation, le logiciel marche **sans Internet**.

(C'est la version « sans effort » de `docs/version-locale.md`, qui explique le principe : un ordinateur principal, les autres appareils s'y connectent par le réseau de l'hôtel.)

## 1. Obtenir l'installateur

L'installateur est **construit et testé automatiquement sur un vrai Windows** par GitHub. À chaque fois, le test fait : installation silencieuse → démarrage → navigateur (inscription d'un hôtel, console éditeur) → sauvegarde → panne simulée → restauration → mise à jour par-dessus → désinstallation. Le fichier n'est proposé que si tout est passé.

1. GitHub → votre dépôt → **Actions** → **Installateur Windows**.
2. Cliquez sur la dernière exécution **avec la coche verte**.
3. En bas de la page, section **Artifacts** : téléchargez **HotelManagerPro-Setup** (un zip qui contient le `.exe`, à décompresser).
4. Mettez le `.exe` sur une clé USB (environ 150 Mo). Il est conservé 30 jours sur GitHub : retéléchargez-le quand il faut.

Pour en fabriquer un nouveau après une modification du logiciel : Actions → **Installateur Windows** → **Run workflow**.

## 2. Installer chez le client (5 minutes)

1. Sur l'**ordinateur principal** de l'hôtel, double-cliquez sur `HotelManagerPro-Setup-….exe`.
2. Windows affiche **« Windows a protégé votre PC »** : le fichier n'est pas signé numériquement (un certificat de signature coûte cher et n'a de sens qu'à grande échelle). Cliquez sur **Informations complémentaires**, puis **Exécuter quand même**. Un antivirus peut aussi poser une question : le fichier est le vôtre, autorisez-le.
3. **Oui** à la demande d'autorisation (administrateur), puis **Suivant**. Laissez le dossier `C:\HotelManagerPro`.
4. À la question « Démarrer automatiquement à l'ouverture de Windows ? » : **Oui** sur l'ordinateur principal.
5. Attendez la fin (3 à 6 minutes), laissez cochée « Lancer Hotel Manager Pro maintenant », **Terminer**.

L'installateur fait aussi : les raccourcis (bureau et menu Démarrer), l'autorisation du réseau local dans le pare-feu Windows (réseaux privés), et, si besoin, l'installation de la bibliothèque Microsoft Visual C++ (nécessaire à la base de données).

## 3. Premier lancement (vous, avec le client)

Une **fenêtre noire** s'ouvre. Ne la fermez pas.

1. « Création de la base de données… » (environ 1 minute, une seule fois).
2. Elle demande l'**e-mail de l'éditeur**, un nom, puis un mot de passe (10 caractères minimum, lettres et chiffres ; des `*` s'affichent). C'est **votre** compte (console de gestion : licences, établissements), pas celui du client. Appuyez sur Entrée pour passer et le créer plus tard (menu Démarrer → *Créer un compte éditeur*).
3. « Hotel Manager Pro est prêt » : Chrome (ou le navigateur par défaut) s'ouvre.

**Ensuite**, dans le navigateur :
- Page **`/inscription`** : créez l'hôtel avec le nom, l'e-mail et le mot de passe **du propriétaire** (il les choisit devant vous).
- Console éditeur (`/platform/connexion`, avec votre compte) → **Établissements** → l'hôtel → **Émettre une licence définitive** (droit d'usage perpétuel). Sinon, la période d'essai de 14 jours s'applique.
- Le propriétaire crée les comptes de ses employés dans **Personnel**.

## 4. Les autres ordinateurs et téléphones

La fenêtre noire affiche l'adresse pour les autres appareils, par exemple `http://192.168.1.20:5173`, et aussi une adresse avec le **nom de l'ordinateur** (plus stable). Sur chaque appareil : même Wi-Fi (ou même câble), Chrome, taper cette adresse, se connecter avec son propre compte. Aucun programme à installer sur ces appareils.

- **Pas de Wi-Fi dans l'hôtel ?** Un petit routeur Wi-Fi, branché à l'électricité et relié par câble à l'ordinateur principal, crée le réseau sans Internet (voir `docs/version-locale.md`).
- **Un appareil n'arrive pas à se connecter ?** Vérifiez que le Wi-Fi de l'hôtel est classé **« Privé »** sur l'ordinateur principal (Windows le classe parfois « Public », et le pare-feu bloque alors les autres appareils) : Paramètres → Réseau et Internet → Wi-Fi (ou Ethernet) → le réseau → **Profil réseau : Privé**.

## 5. Au quotidien (à remettre au client)

| Action | Comment |
|---|---|
| Démarrer | Il démarre seul avec Windows, ou double-clic sur **Hotel Manager Pro** (bureau). Ne pas fermer la fenêtre noire. |
| Arrêter | Fermer la fenêtre noire (ou `Ctrl + C`), attendre quelques secondes, puis éteindre l'ordinateur normalement. **Jamais en coupant le courant.** |
| Sauvegarder | Double-clic sur **Sauvegarder Hotel Manager Pro** (menu Démarrer), clé USB branchée. |
| Sauvegarde automatique | Créée à l'installation : **chaque jour à 13 h 30** (ordinateur allumé). |

**Copie sur clé USB, indispensable** : créez dans `C:\HotelManagerPro` un fichier texte `copie-supplementaire.txt` d'**une seule ligne**, le dossier de la clé, par exemple `E:\Sauvegardes-Hotel`. Chaque sauvegarde y est alors recopiée (avec son fichier de clés). Si la clé n'est pas branchée, la sauvegarde sur l'ordinateur est faite quand même et un avertissement s'affiche.

## 6. Mettre à jour

Lancez simplement le **nouvel installateur** sur l'ordinateur principal : il arrête l'ancienne version, remplace le programme, **conserve tout le dossier `donnees` (la base de l'hôtel) et `sauvegardes`**, puis la base est mise à niveau automatiquement au prochain démarrage. Faites une sauvegarde avant, par prudence.

## 7. Panne : ordinateur remplacé ou disque mort

1. Installez Hotel Manager Pro sur le **nouvel** ordinateur (partie 2), lancez-le **une fois** (partie 3 : la base vide est créée), puis **fermez-le**.
2. Branchez la clé de sauvegarde. Menu Démarrer → **Restaurer Hotel Manager Pro**, tapez le chemin du fichier `hmp-AAAAMMJJ-HHMMSS.dump` de la clé (ex. `E:\Sauvegardes-Hotel\hmp-20261122-130000.dump`) ou Entrée pour la plus récente de ce PC.
3. Tapez `OUI`. Une copie de sécurité de ce qui existe est faite d'abord ; les données sont remplacées ; **la clé de chiffrement d'origine est reprise** automatiquement (elle est dans le fichier `….cle.json` à côté de la sauvegarde : gardez toujours les deux ensemble).
4. Relancez Hotel Manager Pro : l'hôtel, ses comptes et ses données sont retrouvés.

## 8. Désinstaller

Paramètres Windows → Applications → **Hotel Manager Pro** → Désinstaller. Le programme, les raccourcis, la règle de pare-feu et la sauvegarde automatique sont retirés ; **les données de l'hôtel et les sauvegardes sont conservées** dans `C:\HotelManagerPro\donnees` et `\sauvegardes`. Ne les supprimez qu'en étant certain de ne plus en avoir besoin.

## 9. Ce qui est installé

| Dossier | Contenu |
|---|---|
| `C:\HotelManagerPro\app` | le logiciel (remplacé à chaque mise à jour) |
| `C:\HotelManagerPro\runtime` | Node.js et PostgreSQL 16 (remplacé à chaque mise à jour) |
| `C:\HotelManagerPro\donnees` | **la base de l'hôtel et ses clés** (jamais supprimé ; accessible uniquement à l'utilisateur Windows qui a lancé le logiciel) |
| `C:\HotelManagerPro\sauvegardes` | les copies de sécurité |

PostgreSQL utilise le port inhabituel **54329** et n'écoute que l'ordinateur lui-même : il ne gêne pas un autre PostgreSQL éventuel et n'est pas visible du réseau. Seul le port **5173** (le logiciel) est ouvert, aux réseaux privés.

## 10. Dépannage

| Problème | Solution |
|---|---|
| « Windows a protégé votre PC » | Informations complémentaires → Exécuter quand même (fichier non signé). |
| La fenêtre noire s'arrête avec un message | Notez le message (les derniers messages de la base et du serveur sont affichés) et contactez l'éditeur. Journaux : `donnees\serveur.log` et `donnees\postgresql.log`. |
| « Hotel Manager Pro est déjà lancé » | Il tourne déjà : ouvrez Chrome à l'adresse `http://127.0.0.1:5173`. |
| Un autre appareil n'accède pas au logiciel | Même réseau ? Fenêtre noire ouverte ? Réseau classé « Privé » ? (partie 4). |
| Windows a été éteint brutalement | Rien à faire : la base se répare au démarrage suivant. |
| Mot de passe oublié d'un employé | Le propriétaire : **Personnel** → l'employé → réinitialiser le mot de passe. |
| Mot de passe oublié du propriétaire | Pas de réinitialisation par e-mail en local (aucun e-mail configuré). Cas à traiter par l'éditeur : voir « À prévoir » ci-dessous. |

## À savoir

- **Version locale ≠ version en ligne** : leurs données ne se synchronisent pas. Si l'ordinateur principal est éteint, plus personne ne peut travailler. Un **onduleur** est conseillé (coupures d'électricité).
- Sur le réseau de l'hôtel, la connexion est en **HTTP** (sans cadenas) : utilisez un Wi-Fi protégé par mot de passe et **n'ouvrez jamais le logiciel sur Internet** (pas de redirection de port sur la box).
- Les sauvegardes ne sont pas chiffrées : rangez la clé USB comme l'argent de la caisse. Sur l'ordinateur, activez BitLocker si votre Windows le permet.
- **À prévoir** : un outil de secours pour réinitialiser le mot de passe d'un propriétaire, et la **signature** numérique de l'installateur (supprime l'avertissement SmartScreen).
