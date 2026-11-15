# Optional demo analytics

Production release assembly installs one shared, consented GA4 adapter for the gallery and all five demo apps. Local quickstarts and preview hosts do not transmit measurements. A cross-origin frame on www.superdoc.dev runs the Google tag, so the vendor cannot read the demo document, its title or room URL. Only bounded event categories cross the frame boundary. The adapter reuses SuperDoc's existing `G-E4T80WRJGS` property and preference format. It never loads identified CRM tracking.

Public events use fixed demo/action/capability values only. Query values, rooms, filenames, documents, prompts, error text and citation text are excluded. Refusal, withdrawal, DNT, GPC, opt-out and incoming private URLs suppress transport. Later private navigation removes the measurement frame without changing application navigation. Auto-created demo rooms remain measurable only from a clean public entry. Change or withdraw the choice through Privacy settings. Events deduplicate per page and action category, rather than counting keystrokes or polling.

Readiness comes from the editor callback. Review, fields, agent jobs, Q&A and saved versions use actual completion/failure callbacks. Browser export completion does not establish successful Word rendering or a completed developer evaluation. Gallery cards and source/Build this use measure discovery and implementation interest separately. Do not sum per-demo users or compare new collection with an untracked baseline.

`node --test scripts/*.test.mjs` checks the release scripts and bounded consent contract. Build all affected apps and verify actual deployed ingestion before calling tracking live. Growth's existing Analytics and weekly metrics report own reporting; this adds no schedule or provider. Public content and private room semantics are unchanged.

Release order: deploy homepage PR235 and verify its inert frame route first, then merge this gallery PR through the trusted maintainer workflow. The new transport has no historical baseline.

## Every future published demo and example

Josh's November 15 direction applies to every future demo and example, including public customer follow-ups and launches outside this gallery. Before readiness, record the stable resource ID, canonical public destination, developer task, meaningful action and expected result, native social/video metrics where relevant, reporting coverage and collection start date. Reuse the existing consented GA4 transport, Growth Analytics and weekly metrics publisher.

For a gallery addition, CI executes the real adapter against every `demos.json` route and requires its stable ID plus consent/refusal behavior. A new manifest entry with no registered tracking fails the existing release tests. Update the adapter, isolated homepage frame allowlist and Growth labels/queries together, add actual readiness/success/failure callbacks and verify production ingestion after the normal reviewed releases. Never add a generic arbitrary-event or arbitrary-URL escape hatch to make coverage pass.

For a new public host or standalone example, prepare the same coverage through its owning repository and normal review before posting. A local quickstart or downloaded source example must remain free of analytics by default. Native video views, link clicks, example downloads and successful interactive actions are different measures. Unsupported platform metrics remain explicitly unavailable, never zero or invented. Do not alter old posts, customer links or private rooms to manufacture attribution. Follow the existing content worker's [future demo measurement standard](https://github.com/superdoc/sales-engine/blob/main/docs/demo-analytics.md#future-demos-and-examples).
