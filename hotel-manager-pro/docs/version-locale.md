# Version locale : Hotel Manager Pro dans l'hôtel, sans Internet

Le client veut le logiciel **dans son ordinateur**, pour travailler même sans connexion. C'est possible : le logiciel et ses données vivent sur **un ordinateur principal** de l'hôtel ; les autres ordinateurs et téléphones s'y connectent par le **réseau de l'hôtel** (Wi-Fi, box ou point d'accès), sans Internet.

```
   Ordinateur principal (reste allumé)          Réception (PC)   Téléphone de la gouvernante
   ┌──────────────────────────────┐   Wi-Fi    ┌───────────┐    ┌───────────┐
   │ PostgreSQL + Hotel Manager   │◄──────────►│ Chrome    │    │ Chrome    │
   │ Pro  (données de l'hôtel)    │  de l'hôtel│ 192.168…  │    │ 192.168…  │
   └──────────────────────────────┘            └───────────┘    └───────────┘
```

## Ce que c'est, et ce que ce n'est pas

| | Version **en ligne** (Vercel) | Version **locale** (chez le client) |
|---|---|---|
| Internet nécessaire pour travailler | Oui | **Non** (seulement pour installer et pour les mises à jour) |
| Où sont les données | Chez l'hébergeur (Neon) | **Sur l'ordinateur principal de l'hôtel** |
| Plusieurs appareils | Oui, de partout | Oui, **dans l'hôtel** (même réseau) |
| Si l'ordinateur principal est éteint | Rien ne change | **Plus personne ne peut travailler** |
| Sauvegardes | Automatiques chaque nuit | **À faire sur place** (un double-clic, voir plus bas) |
| Mises à jour | Automatiques | Par vous, avec un nouveau paquet |

**Important : une installation locale est séparée de la version en ligne.** Les données ne se synchronisent pas entre les deux (un hôtel saisi en ligne n'apparaît pas dans la version locale, et inversement). Un mode « local qui se synchronise ensuite avec Internet » est un autre projet, beaucoup plus gros.

---

## Partie A — Vous : installer chez le client (environ 45 minutes)

### Avant d'aller chez le client

1. **Préparez le paquet** sur votre ordinateur (Invite de commandes, dossier `GLOBAL\hotel-manager-pro`, après `git pull`) :

```bash
git archive --format=zip --output=%USERPROFILE%\Desktop\hotel-manager-pro-client.zip HEAD
```

   Le zip contient le logiciel, **sans** aucune donnée, aucun mot de passe, aucun fichier `.env`. Mettez-le sur une clé USB. Donnez le paquet vous-même : ne donnez pas l'accès à votre dépôt GitHub (c'est votre travail).
2. Il faut **Internet une seule fois** pour installer (partagez la connexion de votre téléphone). Après, plus besoin.

### Sur l'ordinateur principal du client

1. **Installez** Node.js 22, Google Chrome et PostgreSQL 16, puis pnpm : mêmes étapes que `docs/lancement-local-windows.md` (étapes 1 à 3). Pour PostgreSQL, choisissez un mot de passe `postgres` : **écrivez-le sur papier pour le client**.
2. **Dézippez** le paquet dans `C:\HotelManagerPro` (pas dans Documents ni Bureau : OneDrive peut les synchroniser et casser la base).
3. Ouvrez l'Invite de commandes **dans ce dossier** (`cd /d C:\HotelManagerPro`) et tapez :

```bash
pnpm install
pnpm local:setup --client
```

   `--client` est la différence importante avec votre propre ordinateur : mot de passe de base **aléatoire** (jamais le mot de passe de développement connu), **clé de chiffrement propre** à cet hôtel, réglages de sécurité normaux. À la question « e-mail », mettez **le vôtre** : vous serez le super-administrateur de cette installation (console `/platform/connexion`) ; le client n'a pas besoin de cette console.
4. **Démarrez** : double-clic sur **`Lancer-Hotel-Manager-Pro.cmd`** (ou `pnpm local:start --lan`). La première fois, l'interface est préparée (1 à 2 minutes). Windows demande **« Autoriser l'accès »** (pare-feu) : cochez **Réseaux privés**, puis Autoriser. Chrome s'ouvre.
5. **Créez l'hôtel du client** : page `/inscription`, avec l'e-mail et le mot de passe **du propriétaire** (il choisit son mot de passe devant vous).
6. **Accordez la licence** (sinon la période d'essai de 14 jours s'applique) : console `/platform/connexion` → **Établissements** → l'hôtel → **Émettre une licence définitive** (droit d'usage perpétuel). Notez la clé affichée : elle n'est montrée qu'une fois.
7. **Connectez les autres appareils** : la fenêtre noire affiche l'adresse pour les autres appareils, par exemple `http://192.168.1.20:5173`. Tapez-la dans Chrome sur un autre ordinateur ou un téléphone **branché au même Wi-Fi**. Elle affiche aussi une adresse avec le **nom de l'ordinateur** (`http://NOM-DU-PC:5173`), plus stable si la box change l'adresse.
   - **Pas de Wi-Fi dans l'hôtel ?** Deux solutions :
     1. **Recommandée : un petit routeur Wi-Fi** (quelques dizaines de milliers d'ariary), branché à l'électricité et relié à l'ordinateur principal par un câble réseau. Il crée le réseau de l'hôtel **sans Internet** ; ordinateurs et téléphones s'y connectent (mot de passe Wi-Fi à changer). C'est la plus fiable et elle ne dépend pas de l'ordinateur principal.
     2. **Le point d'accès de Windows** : Paramètres → Réseau et Internet → **Point d'accès sans fil mobile** → activer ; les téléphones se connectent à ce Wi-Fi puis ouvrent l'adresse de la fenêtre noire (souvent `http://192.168.137.1:5173`). Activez-le **avant** de lancer le logiciel. Attention : Windows refuse parfois de l'activer quand l'ordinateur n'est connecté à **aucun** réseau (message « pas de connexion à partager ») ; dans ce cas, utilisez la solution 1.
8. **Démarrage automatique** (recommandé) : touches `Windows + R`, tapez `shell:startup`, Entrée ; dans ce dossier, créez un **raccourci** vers `Lancer-Hotel-Manager-Pro.cmd` (clic droit → Créer un raccourci). Le logiciel démarre avec la session Windows.
9. **Sauvegarde automatique chaque jour** (une seule commande, adaptez l'heure et le dossier) :

```bash
schtasks /create /tn "Hotel Manager Pro - Sauvegarde" /tr "\"C:\HotelManagerPro\Sauvegarder-Hotel-Manager-Pro.cmd\" auto" /sc daily /st 13:30
```

   Pour une **copie sur clé USB ou disque externe** (indispensable), créez dans `C:\HotelManagerPro` un fichier texte `copie-supplementaire.txt` contenant une seule ligne, le dossier de la clé : `E:\Sauvegardes-Hotel`. Si la clé n'est pas branchée, la sauvegarde sur l'ordinateur est faite quand même et un avertissement s'affiche.
10. **Réglages Windows** : Paramètres → Système → Alimentation → **Mise en veille : jamais** (branché sur secteur). Un **onduleur** est fortement conseillé : une coupure d'électricité brutale est le principal risque pour les données.

### À remettre au client

- Le mot de passe du propriétaire (il le connaît) et le mot de passe `postgres` (papier, rangé à part).
- La **Partie B** de ce document, imprimée.
- La clé USB de sauvegarde et la consigne : **la brancher chaque jour**.

---

## Partie B — Le client : travailler au quotidien

**Allumer.** Allumez l'ordinateur principal. Le logiciel démarre seul (une fenêtre noire s'ouvre : **ne la fermez pas**). Sinon, double-clic sur « Lancer Hotel Manager Pro ».

**Travailler.** Ouvrez Google Chrome :
- **sur l'ordinateur principal** : `http://127.0.0.1:5173` ;
- **sur les autres ordinateurs et les téléphones** (même Wi-Fi) : l'adresse écrite dans la fenêtre noire (par exemple `http://192.168.1.20:5173`). Astuce : ajoutez-la aux favoris, ou « Ajouter à l'écran d'accueil » sur le téléphone.

Connectez-vous avec votre e-mail et votre mot de passe. Tout le personnel peut travailler **en même temps**, chacun avec son compte.

**Chaque jour, le soir.** Branchez la clé USB, double-cliquez sur **« Sauvegarder Hotel Manager Pro »** : la fenêtre affiche « Sauvegarde vérifiée ». (Si la sauvegarde automatique est installée, vérifiez juste que la clé est branchée.) **Rangez la clé hors de l'ordinateur.**

**Éteindre.** Fermez la fenêtre noire avec `Ctrl + C` (répondre `O` si Windows demande), puis éteignez l'ordinateur normalement. **Jamais en coupant le courant.**

**Si quelque chose ne marche pas :**

| Problème | Que faire |
|---|---|
| « Impossible de se connecter » sur un téléphone | L'ordinateur principal est-il allumé ? La fenêtre noire est-elle ouverte ? Le téléphone est-il sur le **même Wi-Fi** ? |
| L'adresse ne marche plus | Regardez l'adresse affichée dans la fenêtre noire : elle a pu changer. |
| La fenêtre noire s'est fermée | Double-clic sur « Lancer Hotel Manager Pro ». Vos données sont intactes. |
| Mot de passe oublié d'un employé | Le propriétaire : menu **Personnel** → l'employé → réinitialiser le mot de passe. |
| Autre problème | Notez le message affiché et appelez l'éditeur. |

---

## Plusieurs ordinateurs dans l'hôtel

**Un seul ordinateur « principal »** (le serveur) fait tourner le logiciel et garde les données. Tous les autres appareils — ordinateurs de la réception, du restaurant, de la direction, téléphones, tablettes — **n'ont rien à installer** : seulement Google Chrome (ou un autre navigateur), connecté au même réseau.

Pour **chaque appareil supplémentaire** (2 minutes) :
1. Le brancher au réseau de l'hôtel : le Wi-Fi du routeur, ou un câble réseau.
2. Ouvrir Chrome et taper l'adresse affichée dans la fenêtre noire de l'ordinateur principal (`http://192.168.1.20:5173` ou `http://NOM-DU-PC:5173`).
3. Se connecter avec **son propre compte** (un compte par employé : créés par le propriétaire dans **Personnel**).
4. Pour ne plus retaper l'adresse : Chrome → menu ⋮ → **Enregistrer et partager → Créer un raccourci** (ordinateur) ou **Ajouter à l'écran d'accueil** (téléphone).

À savoir :
- Tout le monde travaille **en même temps** et voit les mêmes données instantanément (une chambre réservée à la réception apparaît tout de suite au calendrier de la direction). Deux personnes qui réservent la **même chambre aux mêmes dates** au même instant : une seule réservation passe, l'autre reçoit « chambre non disponible » (testé).
- Chaque appareil a ses **propres limites de sécurité** : des mots de passe faux saisis sur un poste ne bloquent pas les autres postes (testé, voir plus bas).
- Les droits dépendent du **rôle** de chaque employé (réception, comptabilité, gouvernante…), comme en ligne.
- Le **PDF d'une facture** s'ouvre sur l'appareil où l'on clique : il s'imprime depuis cet appareil.
- **Deux ordinateurs sans réseau entre eux = deux installations séparées**, avec chacune ses propres données, jamais fusionnées. Ne l'acceptez pas pour un même hôtel : il faut toujours un réseau (même un petit routeur) entre les appareils et **un seul** ordinateur principal.
- **Plusieurs bâtiments** distants (deux hôtels, deux sites) : une installation par site, ou la version en ligne.

## Mettre à jour une installation (vous)

1. Sur l'ordinateur principal du client, faites une **sauvegarde** (double-clic).
2. Préparez un nouveau zip (commande `git archive` ci-dessus), **dézippez-le par-dessus** `C:\HotelManagerPro` (« remplacer les fichiers »). Le zip ne contient ni `.env`, ni sauvegardes, ni base : rien de personnel n'est écrasé.
3. Dans l'Invite de commandes, dossier `C:\HotelManagerPro` : `pnpm install` (Internet), puis double-clic sur **Lancer**. Les nouvelles tables sont créées automatiquement et l'interface est recompilée.

## Panne grave : l'ordinateur est remplacé ou le disque est mort

Il faut la **clé USB de sauvegarde** (elle contient aussi le fichier des clés `….env.txt` : sans lui, les numéros de pièces d'identité seraient illisibles).

1. Sur le **nouvel** ordinateur : installez comme en partie A (étapes 1 à 3, `pnpm local:setup --client`).
2. Copiez dans `C:\HotelManagerPro\sauvegardes` les **deux fichiers** de la dernière sauvegarde (`hmp-….dump` et `hmp-….env.txt`).
3. **Fermez le logiciel**, puis :

```bash
pnpm local:restore sauvegardes\hmp-AAAAMMJJ-HHMMSS.dump
```

   La commande demande de taper `OUI`, fait d'abord une copie de sécurité de ce qui existe (`avant-restauration-…`), remplace les données, met la base à niveau et **reprend la clé de chiffrement d'origine**. Relancez ensuite le logiciel : l'hôtel est retrouvé, avec ses comptes.

---

## Sécurité : ce qu'il faut savoir

- Sur le réseau de l'hôtel, la connexion est en **HTTP** (pas de cadenas), car un certificat HTTPS n'existe que pour un nom de domaine sur Internet. Utilisez un **Wi-Fi protégé par mot de passe** (WPA2 ou WPA3) et ne le donnez pas aux clients de l'hôtel.
- **Ne jamais ouvrir le logiciel sur Internet** (pas de « redirection de port » sur la box) : il n'est prévu que pour le réseau de l'hôtel. L'API écoute uniquement l'ordinateur principal ; seule l'interface est visible sur le réseau, et seules les adresses du réseau **privé** sont acceptées (une adresse d'Internet est refusée).
- L'ordinateur contient des données personnelles de clients : mot de passe Windows, session verrouillée, idéalement **BitLocker** (chiffrement du disque, Windows Pro).
- Les sauvegardes ne sont **pas chiffrées** (elles servent à être relues par le client) : la clé USB doit être rangée comme l'argent de la caisse.
- L'e-mail n'est pas configuré en local : « mot de passe oublié » par e-mail n'existe pas. Le propriétaire doit garder son mot de passe en lieu sûr. (Cas non couvert : propriétaire qui oublie son propre mot de passe. À prévoir plus tard : outil de secours pour l'éditeur.)

## Ce qui a été vérifié, et ce qui ne l'a pas été

**Vérifié** (sous Linux, avec une vraie base PostgreSQL 16 et un vrai navigateur) : installation « client » (mot de passe aléatoire, clé propre) ; démarrage en mode réseau ; inscription et connexion par une autre adresse que `127.0.0.1` ; acceptation des adresses de réseau privé et refus d'Internet (3 tests automatiques) ; **limites de sécurité par appareil** (sans cela, quelques mots de passe faux sur un poste bloquaient tous les autres : défaut trouvé pendant ce test, corrigé, couvert par 3 tests automatiques) ; adresse forgée par un appareil du réseau ignorée ; sauvegarde vérifiée avec copie supplémentaire ; **panne simulée** (base et `.env` perdus, « ordinateur neuf », restauration) : hôtels retrouvés, clé de chiffrement reprise, connexion hôtel et console réussies ; recompilation de l'interface après modification.

**Non vérifié** (pas de Windows ici) : les deux fichiers `.cmd`, la tâche planifiée `schtasks`, le pare-feu Windows, le point d'accès mobile de Windows et l'adresse `192.168.137.1`, la connexion depuis un vrai téléphone, la recherche de `pg_dump.exe` dans `C:\Program Files\PostgreSQL`. Faites un **essai complet chez vous** (deux appareils sur votre Wi-Fi, une sauvegarde, une restauration) avant la première installation chez un client.
