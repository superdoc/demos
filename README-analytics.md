# Optional demo analytics

Production release assembly installs one shared, consented GA4 adapter for the gallery and all five demo apps. Local quickstarts and preview hosts do not transmit measurements. A cross-origin frame on www.superdoc.dev runs the Google tag, so the vendor cannot read the demo document, its title or room URL. Only bounded event categories cross the frame boundary. The adapter reuses SuperDoc's existing `G-E4T80WRJGS` property and preference format. It never loads identified CRM tracking.

Public events use fixed demo/action/capability values only. Query values, rooms, filenames, documents, prompts, error text and citation text are excluded. Refusal, withdrawal, DNT, GPC, opt-out and incoming private URLs suppress transport. Later private navigation removes the measurement frame without changing application navigation. Auto-created demo rooms remain measurable only from a clean public entry. Change or withdraw the choice through Privacy settings. Events deduplicate per page and action category, rather than counting keystrokes or polling.

Readiness comes from the editor callback. Review, fields, agent jobs, Q&A and saved versions use actual completion/failure callbacks. Browser export completion does not establish successful Word rendering or a completed developer evaluation. Gallery cards and source/Build this use measure discovery and implementation interest separately. Do not sum per-demo users or compare new collection with an untracked baseline.

`node --test scripts/*.test.mjs` checks the release scripts and bounded consent contract. Build all affected apps and verify actual deployed ingestion before calling tracking live. Growth's existing Analytics and weekly metrics report own reporting; this adds no schedule or provider. Public content and private room semantics are unchanged.

Release order: deploy homepage PR235 and verify its inert frame route first, then merge this gallery PR through the trusted maintainer workflow. The new transport has no historical baseline.
