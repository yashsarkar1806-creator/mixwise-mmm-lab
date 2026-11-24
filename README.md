# Mixwise: marketing mix model lab for app and SaaS growth teams

**Fictional tech startup concept + working demo.** Mixwise is a lightweight marketing mix model (MMM) that runs in the browser. Upload weekly spend and signups and it estimates each paid channel's **incremental** ROI, carry-over and saturation. It then gives a **Scale / Hold / Trim** verdict per channel and a budget plan for the same spend. No cookies or user-level tracking needed.

**Live demo:** https://yashsarkar1806-creator.github.io/mixwise-mmm-lab/demo.html (add `?debug=1` to see GA4-style tracking events)
**Landing page:** https://yashsarkar1806-creator.github.io/mixwise-mmm-lab/
**Startup brief:** https://yashsarkar1806-creator.github.io/mixwise-mmm-lab/brief.html

> Mixwise and the demo brand **Tallyo** (a budgeting app) are fictional. All data is **synthetic**: 156 weeks for India (₹) or Australia (A$), generated with known true channel effects so the model can be checked against the truth.

## What it does

| Feature | What a marketer gets |
|---|---|
| In-browser MMM | Geometric adstock (carry-over) + Hill saturation per channel, and a ridge regression with non-negative media effects plus trend, seasonality and event controls (festive sale, IPL, EOFY, Black Friday) |
| Hyperparameter search | Coordinate grid search over carry-over (0–80%) and half-saturation point (0.7–3.2× average spend) per channel. Fits in under a second |
| Validation | R², NRMSE, a **13-week holdout forecast** (MAPE) and **bootstrap 80% ROI ranges** (residual block bootstrap) |
| Ground-truth check | On synthetic data, true vs estimated ROI and carry-over per channel, so you can see where MMM misses |
| Channel scorecard | Spend vs effect share, incremental KPI, cost per incremental subscriber, average ROI, **next-dollar (marginal) ROI** and a Scale / Hold / Trim verdict against a target ROI |
| Charts | Actual vs fitted with the holdout shaded, weekly decomposition (base + each channel), share of spend vs effect, response curves |
| Budget optimiser | Greedy marginal allocation of a weekly budget with min/max guardrails per channel. Shows modelled uplift, cost per incremental and extra margin a year |
| Lift-test check | Enter a geo or platform lift result. It flags whether the model is too optimistic or too pessimistic (±30%) |
| Bring your own data | CSV upload (`date,kpi,spend_*,ctrl_*`), plus data CSV, decomposition CSV and Markdown readout exports |
| Landing page | Positioning, A/B/C headline test, INR/AUD monthly/annual pricing, lead-scored design-partner form with UTM capture, GA4-style `dataLayer` events, OG/JSON-LD |
| Startup brief | Problem, ICP and persona, positioning statement, MVP, GTM, pricing, key metrics, competition, risks |

## Marketing skills shown

- **Marketing measurement / analytics:** MMM concepts (adstock, diminishing returns, base vs incremental), holdout validation, uncertainty ranges and calibration against lift tests
- **Performance and growth marketing:** marginal vs average ROI, budget reallocation with guardrails, cost per incremental subscriber against margin
- **Market research honesty:** a ground-truth check showing where the model is wrong, plus plain-English caveats
- **Startup / GTM:** ICP, persona, positioning, design-partner and agency GTM, tiered INR/AUD pricing, a metrics tree
- **Digital / CRO:** conversion landing page, headline A/B test, lead scoring, UTM attribution, event tracking

## How to run

No build step and no dependencies. It is plain HTML/CSS/JS.

```bash
git clone https://github.com/yashsarkar1806-creator/mixwise-mmm-lab
cd mixwise-mmm-lab
python3 -m http.server 8080   # open http://localhost:8080/demo.html
npm test                      # 26 Node tests (node --test), Node 18+
```

### CSV format

One row per week, at least 26 weeks (52+ recommended):

```
date,kpi,spend_meta,spend_google_search,spend_youtube,ctrl_festive_sale
2025-01-06,4120,512000,298000,0,0
```

Columns starting `spend_` become channels. Columns starting `ctrl_` are events or controls. Click **Download data CSV** in the demo for a full example.

## How the model works

For each channel: `feature = hill(adstock(spend, decay) × (1 − decay) / mean_spend, k)`, where `hill(x, k) = x / (x + k)`. The KPI is regressed on all channel features (coefficients ≥ 0), a linear trend, two yearly Fourier pairs and the event flags, using ridge regression solved by coordinate descent. `decay` and `k` are chosen per channel by grid search on the training weeks. The model is refit on the training weeks only to forecast the last 13 weeks (holdout), then refit on all weeks for the decomposition. Marginal ROI is the slope of the steady-state response curve at the average weekly spend of the last 13 weeks.

Limits, stated honestly: MMM is correlational. Channels whose spend moves together are hard to separate. Bootstrap ranges hold the hyperparameters fixed, so they understate the true uncertainty. Curves outside the historical spend range are extrapolation. Production tools such as [Robyn](https://github.com/facebookexperimental/Robyn) (MIT), [Meridian](https://github.com/google/meridian) (Apache-2.0) and [PyMC-Marketing](https://github.com/pymc-labs/pymc-marketing) (Apache-2.0) add Bayesian priors, lift-test calibration and richer diagnostics. This project is a transparent, teachable version of the same ideas.

Files: `lib/mmm.js` (all maths, pure functions), `lib/site.js` (pricing, lead scoring, UTM, tracking), `app.js` (demo UI and canvas charts), `landing.js`, `index.html`, `demo.html`, `brief.html`, `tests/`.

## Data note

All data is synthetic and generated in code (`generateSynthetic` in `lib/mmm.js`) with a fixed seed. No real brand, app, agency or employer data is used. Pricing and market figures in the brief are assumptions for a concept, not research findings.

## License

MIT, see [LICENSE](LICENSE).
