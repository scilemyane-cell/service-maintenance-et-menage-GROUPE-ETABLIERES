# Novimmo Astreinte — Phase 1

Application de gestion d'astreinte (planning équilibré, absences, interventions,
synthèse) pour le Groupe Établières, connectée à Firebase (Auth + Firestore + Hosting).

Ce dépôt est **vide de toute donnée réelle** : tu vas créer ton propre projet
Firebase de zéro et brancher ce code dessus.

---

## 1. Créer le projet Firebase (10 minutes, dans ton navigateur)

1. Va sur **https://console.firebase.google.com**
2. **Ajouter un projet** → nomme-le par exemple `etablieres-astreinte` → suis les étapes (tu peux désactiver Google Analytics, pas nécessaire ici)
3. Une fois le projet créé, dans le menu de gauche :
   - **Build → Authentication** → *Get started* → onglet *Sign-in method* → active **E-mail/Mot de passe**
   - **Build → Firestore Database** → *Create database* → choisis une région proche (`eur3` / Europe) → démarre en **mode production**
   - **Build → Hosting** → *Get started* (tu peux passer les étapes d'installation CLI, on les refera ci-dessous proprement)
4. Va dans **Paramètres du projet** (icône ⚙️ en haut à gauche) → onglet **Général** → section *Vos applications* → clique l'icône **</>** (Web) → donne un nom (ex. `astreinte-web`) → **Ne coche PAS** "Configurer Firebase Hosting" ici (déjà fait) → *Enregistrer l'application*
5. Firebase affiche un objet `firebaseConfig` — **copie-le entièrement**, tu en as besoin à l'étape 3.

---

## 2. Récupérer le code

Ce dossier `novimmo-astreinte/` contient tout le code. Structure :

```
novimmo-astreinte/
├── firebase.json          → config Hosting
├── firestore.rules        → règles de sécurité (qui a le droit de lire/écrire quoi)
├── .firebaserc             → identifiant de ton projet Firebase
├── README.md               → ce guide
└── public/
    ├── index.html          → page de connexion
    ├── app.html             → application (après connexion)
    ├── css/style.css        → thème visuel
    └── js/
        ├── firebase-config.js   → TES identifiants Firebase (à remplir, étape 3)
        ├── firebase-init.js     → initialise Firebase (ne pas toucher)
        ├── auth.js               → connexion / déconnexion / rôles
        ├── astreinte-logic.js    → calendrier, jours fériés, algorithme d'équilibrage (testé)
        ├── firestore-data.js     → lecture/écriture Firestore
        └── planning.js           → l'application (calendrier, absences, interventions, synthèse)
```

---

## 3. Configurer tes identifiants Firebase

Ouvre `public/js/firebase-config.js` et remplace les valeurs `"REMPLACE_MOI"`
par celles copiées à l'étape 1.5. Exemple :

```js
export const firebaseConfig = {
  apiKey: "AIzaSyABCDEF...",
  authDomain: "etablieres-astreinte.firebaseapp.com",
  projectId: "etablieres-astreinte",
  storageBucket: "etablieres-astreinte.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef",
};
```

Ces valeurs **ne sont pas secrètes** — elles sont conçues pour être visibles
dans le code du site. Ta vraie protection, c'est `firestore.rules`.

Ouvre aussi `.firebaserc` et remplace `REMPLACE_PAR_TON_PROJECT_ID` par ton
`projectId` (ex. `etablieres-astreinte`).

---

## 4. Installer les outils et déployer

Sur ton ordinateur (nécessite [Node.js](https://nodejs.org) installé) :

```bash
npm install -g firebase-tools     # une seule fois, installe l'outil Firebase
firebase login                     # ouvre ton navigateur pour te connecter
cd novimmo-astreinte               # place-toi dans ce dossier
firebase deploy                    # déploie le site ET les règles Firestore
```

À la fin, le terminal affiche une URL du type
`https://etablieres-astreinte.web.app` — c'est ton application, en ligne.

---

## 5. Créer le tout premier compte (administrateur)

Comme la base est vide, il n'y a encore aucun utilisateur. Deux étapes :

**a) Créer le compte de connexion**
Dans la console Firebase → **Authentication → Users → Add user** → renseigne
ton email et un mot de passe. Note le **User UID** généré (une longue chaîne
de caractères) — clique sur l'utilisateur pour le voir.

**b) Lui donner le rôle admin**
Dans la console Firebase → **Firestore Database → Start collection** :
- ID de la collection : `users`
- ID du document : colle le **User UID** de l'étape a)
- Ajoute les champs :
  - `role` (string) → `admin`
  - `nom` (string) → ton nom, ex. `Valentin`

Enregistre. Tu peux maintenant te connecter sur l'URL de ton site avec cet
email/mot de passe : tu arrives en administrateur.

Répète l'étape b) (avec un nouvel utilisateur créé en a) pour chaque
personne : Lionel (`role: n1`), les techniciens (`role: technicien`),
Frédéric (`role: direction`). Les rôles `menage` et `mi_temps` existent déjà
dans le code mais leur espace dédié arrive en phase 3.

---

## 6. Ce qui est inclus dans cette Phase 1

- Connexion par email/mot de passe, avec rôles (admin, n1, technicien, direction)
- Calendrier d'astreinte avec algorithme d'équilibrage automatique (pondération week-end/jours fériés)
- Gestion des absences par plage de dates précises (pas forcément une semaine entière)
- Journal des interventions (date, technicien, site, type, heures, description)
- Synthèse avec répartition par type/site et heures cumulées par technicien
- Toutes les données sont en temps réel (Firestore) : si Lionel modifie une absence, tu la vois apparaître immédiatement sans recharger la page

## Ce qui n'est PAS encore fait (prochaines phases)

- Phase 2 — Dossiers de site + QR code (lecture seule)
- Phase 3 — Espace Ménage / Mi-temps : saisie et validation des heures, alerte de dépassement légal
- Phase 4 — Dashboard direction consolidé

---

## Notes techniques

- **L'année scolaire est codée en dur** dans `astreinte-logic.js`
  (constantes `WEEKS_START`, `YEAR_START`, `YEAR_END`, `buildHolidays(2026)`).
  Chaque été, il faudra changer ces dates pour l'année suivante — je peux
  automatiser ça dans une prochaine phase (calcul dynamique de l'année scolaire en cours).
- **Aucune build tool** (pas de Vite/Webpack) : le code s'exécute tel quel dans
  le navigateur via les modules ES natifs et le SDK Firebase chargé depuis son
  CDN officiel (`gstatic.com`). Volontairement simple pour une phase 1 —
  si le projet grossit beaucoup, on pourra migrer vers un vrai build plus tard.
- **Pas de tests automatisés en ligne** dans ce dépôt, mais la logique de
  `astreinte-logic.js` a été testée manuellement en dehors du navigateur
  (fonctions pures, sans dépendance Firebase/DOM) avant livraison.
