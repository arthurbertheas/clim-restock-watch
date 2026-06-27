import { readFileSync } from "node:fs";
import { runCheck, type RunDeps } from "./check";
import { httpFetch, firecrawlFetch } from "./fetchPage";
import { loadState, saveState } from "./state";
import { sendAlertEmail } from "./notify";
import type { WatchEntry } from "./types";

const WATCHLIST_PATH = "watchlist.json";
const STATE_PATH = "state.json";

async function main(): Promise<void> {
  let watchlist: WatchEntry[];
  try {
    watchlist = JSON.parse(readFileSync(WATCHLIST_PATH, "utf8")) as WatchEntry[];
  } catch {
    console.error(`ERREUR: ${WATCHLIST_PATH} introuvable ou invalide — cree-le a partir de l'exemple du README.`);
    process.exitCode = 1;
    return;
  }
  const state = loadState(STATE_PATH);
  const apiKey = process.env.FIRECRAWL_API_KEY ?? null;

  const deps: RunDeps = {
    now: new Date(),
    http: httpFetch,
    firecrawl: (url) => firecrawlFetch(url, apiKey ?? ""),
    firecrawlApiKey: apiKey,
    log: (m) => console.log(m),
  };

  const alerts = await runCheck(watchlist, state, deps);
  saveState(STATE_PATH, state);

  if (alerts.length > 0) {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const to = process.env.ALERT_TO;
    if (!user || !pass || !to) {
      console.error("ERREUR: SMTP_USER / SMTP_PASS / ALERT_TO manquants, email non envoye.");
      process.exitCode = 1;
      return;
    }
    await sendAlertEmail(alerts, { user, pass, to });
    console.log(`Email envoye pour ${alerts.length} retour(s) en stock.`);
  } else {
    console.log("Aucun retour en stock.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
