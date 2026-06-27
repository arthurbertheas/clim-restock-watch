# clim-restock-watch

Alerte email quand une climatisation repasse en stock sur une fiche produit e-commerce FR.
Tourne gratuitement via GitHub Actions (cron toutes les 15 min).

## Comment ca marche
1. `watchlist.json` liste les fiches produit a surveiller.
2. Toutes les 15 min, le workflow recupere chaque page (fetch gratuit, Firecrawl en
   fallback si bloquee), lit le stock via le JSON-LD schema.org, et met a jour `state.json`.
3. Quand un produit passe de `rupture`/`inconnu` a `en_stock`, tu recois un email.

## Installation
1. Pousse ce repo sur GitHub.
2. Renseigne les secrets (Settings > Secrets and variables > Actions) :
   - `SMTP_USER` : ton adresse Gmail.
   - `SMTP_PASS` : un **mot de passe d'application** Gmail (myaccount.google.com > Securite >
     Validation en 2 etapes > Mots de passe des applications). PAS ton mot de passe normal.
   - `ALERT_TO` : l'adresse qui recoit les alertes.
   - `FIRECRAWL_API_KEY` : ta cle Firecrawl (optionnel ; sans elle, seulement le fetch gratuit).
3. Le workflow demarre seul au prochain creneau cron (ou via "Run workflow").

## Ajouter une clim a surveiller
Edite `watchlist.json` :
```json
{
  "nom": "Nom lisible",
  "url": "https://...",
  "method": "auto",
  "intervalMin": 15,
  "firecrawlIntervalMin": 60,
  "match": null
}
```
Champs : `method` = `auto` | `fetch` | `firecrawl` ; `intervalMin` = cadence de check du fetch gratuit (minutes) ; `firecrawlIntervalMin` = cadence max des appels Firecrawl pour cette URL (minutes) ; `match` = texte présent uniquement si le produit est en stock (optionnel, sinon `null`).

## Budget Firecrawl
Quota free = 1000 scrapes/mois. Le tool ne depasse jamais 950 (plafond de securite) et
n'appelle Firecrawl qu'en fallback (mode `auto`). Au demarrage il avertit si ta config
projette un pire-cas > 1000/mois ; **augmente** alors les `firecrawlIntervalMin` (plus
l'intervalle est grand, moins il y a de scrapes).

## Limite a connaitre
GitHub desactive un workflow planifie apres **60 jours sans commit** sur le repo. Pour le
reactiver : ouvre l'onglet Actions et reactive le workflow, ou fais un commit. En pleine
saison clim, le commit auto de `state.json` suffit a le garder actif.

## Developpement
```bash
npm install
npm test          # suite vitest
npm run check     # lance un cycle en local (variables d'env requises pour l'email)
```
