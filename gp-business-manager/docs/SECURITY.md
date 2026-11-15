# SECURITY — GP Business Manager (application Windows)

## Modèle de menace (application de bureau locale)
Postes partagés entre caissiers, vol/perte d'ordinateur, caissier malveillant (fraude), renderer compromis (XSS via donnée saisie), fichier de sauvegarde falsifié, rejeu de ventes.

## Mesures en place
| Domaine | Mesure |
|---|---|
| Mots de passe | `scrypt` (N=16384, r=8, p=1), sel 16 octets aléatoire, comparaison à temps constant. Minimum 8 caractères. Jamais journalisés (`***`). |
| Authentification | Jeton de session opaque (256 bits aléatoires) **conservé par le processus principal** ; le renderer ne le voit jamais. Expiration d'inactivité (8 h). Déconnexion invalide la session. |
| Anti-force brute | 5 échecs → compte verrouillé 5 min ; message identique pour compte inexistant/mauvais mot de passe ; hachage factice pour temps de réponse uniforme. Échecs journalisés. |
| Autorisations | Contrôle **dans le processus principal** pour chaque appel (`App.call`) ; permissions rechargées à chaque requête (un retrait de droit est immédiat). Refus journalisés. Le dernier administrateur actif ne peut pas être désactivé/rétrogradé. |
| Validation | Schéma Zod sur chaque endpoint ; requêtes SQL **toujours paramétrées** (aucune concaténation de données utilisateur) ; test d'injection SQL. |
| Isolation Electron | `contextIsolation`, `sandbox`, `nodeIntegration:false`, CSP stricte en production (`default-src 'self'`), navigation externe bloquée, `window.open` refusé (https → navigateur système), permissions web refusées, vérification de l'origine (`file://`) des messages IPC. |
| Intégrité financière | Triggers SQLite : écritures validées immuables ; corrections par écritures inverses. Ventes atomiques et idempotentes. |
| Prix | Le prix est recalculé depuis la base à la vente ; une dérogation exige `sale.discount` ; remise du caissier plafonnée (paramétrable). |
| Journal d'audit | `audit_log` immuable : connexions/échecs, création/annulation, ventes, retours, ajustements de stock, clôtures de caisse, changements de droits, accès refusés. |
| Exports | CSV protégé contre l'injection de formule (`=`,`+`,`-`,`@` préfixés par `'`). |
| Sauvegarde / restauration | Copie cohérente (`VACUUM INTO`) ; restauration avec `PRAGMA integrity_check` + vérification de structure avant remplacement, copie de sécurité préalable. Auto-sauvegarde quotidienne (14 j). |
| Secrets | Aucun secret dans le code ni la configuration. |
| Journaux | `gp.log` (userData) : erreurs internes détaillées côté journal, message générique côté interface. |

## Limites connues / à faire
- **Base non chiffrée au repos** : toute personne ayant accès au disque peut lire le fichier SQLite. Recommandation : BitLocker. Chiffrement applicatif (SQLCipher ou chiffrement des sauvegardes) à planifier.
- **Exécutable non signé** : SmartScreen affiche un avertissement tant qu'un certificat de signature de code n'est pas utilisé (voir DEPLOYMENT.md).
- Pas de double authentification, pas d'expiration forcée des mots de passe, pas de politique de complexité au-delà de la longueur.
- Les logs applicatifs peuvent contenir des noms d'utilisateur.
- Mise à jour automatique non implémentée (pas de canal de mise à jour signé) : à ajouter avec la signature.
- Audit de dépendances : `npm audit` signale une vulnérabilité modérée dans `minimatch` (dépendance transitive d'*electron-builder*, **outil de build uniquement**, non embarquée dans l'application livrée).
- Sécurité côté serveur (JWT, refresh rotatif, RLS multi-tenant, Argon2id, limitation de débit) : **non applicable tant que l'API n'existe pas**. Voir ARCHITECTURE.md §6.

## Signalement
Ouvrir un ticket privé auprès du mainteneur ; ne pas publier de vulnérabilité en clair.
