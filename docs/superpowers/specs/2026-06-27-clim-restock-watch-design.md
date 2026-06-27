# clim-restock-watch — Design

> Spec validée le 2026-06-27. Outil perso d'alerte email quand une climatisation repasse en stock sur des fiches produit e-commerce françaises.

## 1. Objectif & périmètre

**But :** être prévenu par **email**, le plus vite possible, quand une **fiche produit précise** (clim) repasse **en stock** chez un marchand français, pour pouvoir l'acheter rapidement (usage canicule).

**Dans le périmètre :**
- Surveillance d'**URLs précises** fournies par l'utilisateur (pas de catégorie, pas de recherche multi-marchands).
- Marchands hétérogènes : petits/spécialistes (faciles), grandes enseignes (Cdiscount/Darty/Boulanger/Fnac/Leroy Merlin/ManoMano), et Amazon.fr (le plus dur).
- Exécution **gratuite et autonome** via GitHub Actions (cron).
- Alerte **uniquement à la transition** rupture → en stock (anti-spam).

**Hors périmètre (YAGNI) :**
- Pas de comparateur public, pas de base de données analytique, pas d'historique de prix.
- Pas de SMS / push / Telegram (email seul).
- Pas d'interface web ; toute la config est dans un fichier JSON du repo.

## 2. Contraintes dures

- **Budget Firecrawl = 1000 scrapes / mois (free tier).** À doser comme une enveloppe, jamais comme un robinet ouvert. Plafond de sécurité interne **~950**. Le tool doit projeter l'usage mensuel à partir de la config et **prévenir avant dépassement**.
- **GitHub Actions cron** désactive un workflow planifié après **60 jours sans commit** sur le repo. Acceptable (saison clim = activité). À documenter dans le README.
- **GitHub cron est best-effort** sur le timing (un run `*/15` peut être retardé de quelques minutes en charge). Acceptable pour une alerte stock.
- **Aucun secret dans le code** : identifiants email + clé Firecrawl uniquement dans les **GitHub Secrets**.

## 3. Architecture mixte (fetch à deux étages)

Cadence du cron : **toutes les 15 min**. Mais chaque URL a sa propre cadence (`intervalMin`) → on découple la fréquence par produit de la fréquence du workflow.

Pour chaque URL **due** (assez de temps écoulé depuis son dernier check) :

```
fetchPage(url, method)
  ├─ method "fetch"     → HTTP simple, headers de navigateur réalistes
  ├─ method "firecrawl" → API Firecrawl (rawHtml), franchit anti-bot/JS
  └─ method "auto"      → tente "fetch" d'abord ;
                          si BLOQUÉ (403/429/captcha/HTML vide) → bascule "firecrawl"
                          (si et seulement si le budget le permet)
        ↓ renvoie { html, source, blocked }
detectStock(html)   → "en_stock" | "rupture" | "inconnu"   (source-agnostique)
        ↓
réconciliation d'état + décision d'alerte
```

Point clé : **`detectStock` ne sait pas d'où vient le HTML.** Fetch gratuit et Firecrawl alimentent exactement le même détecteur. Ça garde le cœur testable et minimise le code ajouté par Firecrawl (juste une branche dans `fetchPage` + le module budget).

### Stratégie par défaut : `auto` (fallback)
- Fetch gratuit d'abord (0 crédit). Firecrawl **seulement** quand la page est bloquée.
- **Deux cadences distinctes par URL** (point essentiel pour ne pas cramer le budget) :
  - `intervalMin` (défaut **15**) : gap minimum entre deux **checks** (fetch gratuit).
  - `firecrawlIntervalMin` (défaut **60**) : gap minimum entre deux **appels Firecrawl** pour cette URL. Même si la page est bloquée à chaque check de 15 min, on n'escalade vers Firecrawl qu'au plus une fois par heure.
- Réglable par URL : `method` (`auto`/`fetch`/`firecrawl`), `intervalMin`, `firecrawlIntervalMin`.

> Exemple : une URL `auto` toujours bloquée → fetch gratuit toutes les 15 min (0 crédit, statut `inconnu`), escalade Firecrawl au plus 1×/h = ~720 scrapes/mois max pour cette URL. Le budget reste maîtrisé même dans le pire cas.

## 4. Détection du stock (cascade)

Ordre de résolution, la **première règle qui tranche gagne** :

1. **JSON-LD schema.org** (principal) : parser tous les `<script type="application/ld+json">`, chercher un `Product`/`Offer` avec `offers.availability`. Mapping :
   - `InStock`, `LimitedAvailability`, `PreOrder`, `BackOrder` → **`en_stock`**
   - `OutOfStock`, `SoldOut`, `Discontinued` → **`rupture`**
2. **Règle `match` par URL** (optionnelle) : si pas de JSON-LD exploitable, un texte/sélecteur fourni par l'utilisateur (ex. présence du bouton « Ajouter au panier »).
3. **Heuristique générique** (best-effort) : présence de marqueurs « ajouter au panier » / « en stock » **et** absence de « indisponible / rupture / épuisé ».
4. **Sinon → `inconnu`.**

**Règle d'or :** une page **bloquée** ou **ambiguë** → `inconnu`. On ne **jamais** interprète un blocage comme `rupture` ni comme `en_stock`. `inconnu` ne déclenche **aucune** alerte (ni faux positif, ni faux négatif silencieux).

## 5. État & anti-spam

`state.json` (commité dans le repo) garde, par URL :
```json
{
  "url": "https://...",
  "status": "rupture",          // dernier statut connu : en_stock | rupture | inconnu
  "lastCheck": "2026-06-27T10:00:00Z",      // dernier check (toute méthode)
  "lastFirecrawl": "2026-06-27T09:00:00Z",  // dernier appel Firecrawl (cadence dédiée)
  "lastAlert": "2026-06-20T08:00:00Z"
}
```
Plus un bloc budget :
```json
{
  "firecrawl": { "month": "2026-06", "count": 137 }
}
```

**Décision d'alerte :** on alerte pour une URL **si et seulement si** son nouveau statut est `en_stock` **et** son statut précédent **n'était pas** `en_stock` (donc `rupture` ou `inconnu`). Tant que ça reste `en_stock` : silence. Repart en `rupture` puis revient : nouvelle alerte.

À la fin du run, le workflow **recommit** `state.json` (compteur budget + statuts + timestamps mis à jour).

## 6. Budget Firecrawl

- Compteur mensuel dans `state.json` (`firecrawl.count`, `firecrawl.month`). **Reset** quand le mois change.
- **Garde-fou** : avant tout appel Firecrawl, si `count >= 950` → on **n'appelle pas**, on log un avertissement, l'URL reste `inconnu` pour ce run (pas d'alerte erronée).
- **Projection (pire cas)** : au démarrage, le tool calcule l'usage mensuel maximal théorique = pour chaque URL en `firecrawl`/`auto`, `43200 / firecrawlIntervalMin` scrapes/mois (≈ minutes par mois ÷ cadence Firecrawl), sommé sur toutes les URLs. Il **affiche un avertissement** si le total dépasse 1000. C'est la borne haute : en `auto`, l'usage réel est bien moindre (Firecrawl ne part que sur blocage).

## 7. Email

- Envoi via **SMTP Gmail + mot de passe d'application** (nodemailer), depuis `notify.ts`.
- Un **seul email récapitulatif** par run s'il y a un ou plusieurs retours en stock : sujet clair + liste `nom → lien direct`.
- Identifiants dans les GitHub Secrets : `SMTP_USER`, `SMTP_PASS`, `ALERT_TO`.
- Pas d'email si rien à signaler (et pas d'email sur les statuts `inconnu`).

## 8. Stack & structure

- **Node 20 + TypeScript.** Dépendances minimales : `cheerio` (parsing HTML/JSON-LD), `nodemailer` (email). Firecrawl appelé en HTTP (fetch natif). Tests : `vitest`.

```
06 clim-restock-watch/
├── watchlist.json              # produits à surveiller (édité par l'utilisateur)
├── state.json                  # état + budget (auto-commit par le workflow)
├── src/
│   ├── check.ts                # orchestrateur (entrypoint du cron)
│   ├── fetchPage.ts            # fetch gratuit + branche Firecrawl + détection blocage
│   ├── detectStock.ts          # cascade JSON-LD → statut (cœur pur, testé)
│   ├── budget.ts               # compteur mensuel + garde-fou + projection
│   ├── state.ts                # lecture/écriture state.json, décision d'alerte
│   └── notify.ts               # email récap (nodemailer)
├── test/
│   ├── fixtures/               # vraies pages HTML sauvegardées par marchand
│   └── detectStock.test.ts     # asserte statut attendu sur chaque fixture
├── .github/workflows/check.yml # cron */15, run + commit state.json
├── package.json
└── README.md                   # setup secrets, ajout d'URL, réactivation cron 60j
```

### Format `watchlist.json`
```json
[
  {
    "nom": "Clim mobile De'Longhi PAC EM90",
    "url": "https://www.exemple.fr/...",
    "method": "auto",            // auto (défaut) | fetch | firecrawl
    "intervalMin": 15,           // gap min entre checks (fetch gratuit)
    "firecrawlIntervalMin": 60,  // gap min entre appels Firecrawl pour cette URL
    "match": null                // override optionnel (texte/sélecteur)
  }
]
```

## 9. Tests & vérification

- **TDD sur `detectStock`** : c'est la partie risquée et pure. Pour chaque marchand visé, sauvegarder une vraie page « en stock » et une « rupture » dans `test/fixtures/`, asserter le statut attendu (`en_stock` / `rupture` / `inconnu`). Couvre aussi le cas JSON-LD absent et le cas page bloquée.
- `budget.ts` et `state.ts` (décision d'alerte, reset mensuel, plafond) : tests unitaires purs.
- `fetchPage.ts` et `notify.ts` (I/O) restent fins : vérification manuelle/intégration (un run réel, un email de test).
- **Garde-fous anti-régression à tester explicitement** : (a) page bloquée → `inconnu`, jamais d'alerte ; (b) statut `en_stock` stable → pas de re-alerte ; (c) `count >= 950` → pas d'appel Firecrawl.

## 10. Risques connus & parti pris

- **Amazon.fr** : même avec Firecrawl, la fiabilité 24/7 n'est pas garantie. Parti pris : best-effort, jamais de faux négatif silencieux (blocage = `inconnu`).
- **Évolution des pages** : si un marchand change son HTML/JSON-LD, une fixture de test cassera → signal pour mettre à jour la règle. C'est volontaire.
- **Budget** : le mode `auto` minimise la consommation ; la projection prévient avant de dépasser. Si l'utilisateur force du `firecrawl` haute fréquence, c'est son choix éclairé.
- **Extensibilité** : l'architecture `fetchPage` pluggable permet d'ajouter plus tard un navigateur headless (Playwright) ou une autre API sans toucher à `detectStock`, l'état, ni l'email.
