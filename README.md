# World Governance Atlas

Leaders, history, "firsts" and public data for every sovereign state, rebuilt automatically every day from open sources.

- **Leaders**: every head of state and head of government on record for 196 countries (for example Nehru → Shastri → Indira Gandhi → … → Modi), with term dates, tenure, party, photo, birth and death, predecessor and successor, and a live Wikipedia biography.
- **History**: Wikipedia's "History of …" overview for every country, plus curated milestone timelines.
- **Firsts**: curated firsts (India: first PM, first President, first CJI, first woman IAS officer, …) and automatic firsts for every country (first holder, first woman, longest-serving, youngest, oldest, most terms).
- **Data**: 28 indicators as yearly time series: governance scores (corruption, rule of law, …), crime (homicide rate, conflict deaths), PM2.5 air pollution, economy, health, education, women in parliament, military spending.
- **Live air quality** (US AQI, PM2.5, PM10, NO₂, O₃) for each capital.
- **Compare** up to four countries, and **rank** all countries on any indicator.

## Run it on your computer

Needs [Node.js](https://nodejs.org) 20 or newer. Nothing else to install.

```bash
cd world-governance
node scripts/serve.mjs
```

Open http://localhost:8080. While that window stays open, the data refreshes itself every 24 hours (each refresh takes ~30 minutes; the site keeps working meanwhile). Leader biographies and air quality load live in the browser.

- Refresh right now: `node scripts/fetch-data.mjs`
- Different port: `PORT=3000 node scripts/serve.mjs` (Windows PowerShell: `$env:PORT=3000; node scripts/serve.mjs`)
- Turn off the automatic refresh: `REFRESH_HOURS=0 node scripts/serve.mjs`

## How auto-update works

`.github/workflows/update-data.yml` runs every day at 02:17 UTC (and on manual dispatch). It
1. runs `scripts/fetch-data.mjs`, which queries Wikidata, Wikipedia and the World Bank and writes `data/`,
2. commits the refreshed JSON,
3. deploys the site to GitHub Pages.

Leader biographies (Wikipedia REST API) and air quality (Open-Meteo) are fetched live in the visitor's browser.

To enable it: push to GitHub, open **Settings → Pages**, and set **Source** to "GitHub Actions". If the scheduled push is rejected by branch protection, let `github-actions[bot]` push to the branch.

## Sources

| Data | Source |
|---|---|
| Countries, offices, office-holders, people | Wikidata (SPARQL + `wbgetentities`) |
| Country summaries, history | Wikipedia extracts API |
| Indicators | World Bank WDI (source 2), Worldwide Governance Indicators (source 3) |
| Live air quality | Open-Meteo Air Quality API (Copernicus CAMS) |
| Curated firsts and milestones | `curated/firsts.json` |

## Extending

- **More curated firsts**: copy the `IND` block in `curated/firsts.json` under another ISO3 code. `wiki` must be an English Wikipedia title; the build adds the photo and description and warns about titles that don't exist.
- **More indicators**: add a row to `INDICATORS` in `scripts/fetch-data.mjs` (any World Bank indicator code). The UI picks it up automatically.
- **Data files**: `data/index.json` holds the country list with latest values, `data/people.json` is the leader search index, and `data/countries/<ISO3>.json` holds the full record per country.

## Who Runs India

`india.html`: governance structure, states & UTs (CMs, Governors, MLAs), MPs, election calendar. Data: `scripts/fetch-india.mjs`, `scripts/fetch-states.mjs`.
