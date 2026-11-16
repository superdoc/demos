# Optional demo analytics

Production release assembly installs one shared, consented GA4 adapter for the gallery and all five demo apps. Local quickstarts and preview hosts do not transmit measurements. A cross-origin frame on www.superdoc.dev runs the Google tag, so the vendor cannot read the demo document, its title or room URL. Only bounded event categories cross the frame boundary. The adapter reuses SuperDoc's existing `G-E4T80WRJGS` property and preference format. It never loads identified CRM tracking.

Public events use fixed demo/action/capability values only. Query values, rooms, filenames, documents, prompts, error text and citation text are excluded. Refusal, withdrawal, DNT, GPC, opt-out and incoming private URLs suppress transport. Later private navigation removes the measurement frame without changing application navigation. Auto-created demo rooms remain measurable only from a clean public entry. Change or withdraw the choice through Privacy settings. Events deduplicate per page and action category, rather than counting keystrokes or polling.

Readiness comes from the editor callback. Review, fields, agent jobs, Q&A and saved versions use actual completion/failure callbacks. Browser export completion does not establish successful Word rendering or a completed developer evaluation. Gallery cards and source/Build this use measure discovery and implementation interest separately. Do not sum per-demo users or compare new collection with an untracked baseline.

`node --test scripts/*.test.mjs` checks the release scripts and bounded consent contract. Build all affected apps and verify actual deployed ingestion before calling tracking live. Growth's existing Analytics and weekly metrics report own reporting; this adds no schedule or provider. Public content and private room semantics are unchanged.

Release order: deploy homepage PR235 and verify its inert frame route first, then merge this gallery PR through the trusted maintainer workflow. The new transport has no historical baseline.

## Verify events after deployment

Permanent console logs are not needed. Check each boundary separately: a browser
custom event, an outgoing Google request, then a received event in GA4.

1. Open `https://demos.superdoc.dev/` without a query or fragment. Open DevTools,
   select **Network**, enable **Preserve log**, and reload. Confirm
   `/demo-analytics.js` returns JavaScript rather than the gallery HTML fallback.
2. Allow optional analytics through the gallery consent control. Wait for the
   `www.superdoc.dev/demo-analytics-frame.html` frame and Google tag to load.
   Declined consent, DNT/GPC, opt-out, private links and blocked Google requests
   prevent collection; do not bypass those controls to make a check pass.
3. Filter Network by `collect` (all request types). Page activation should produce
   `superdoc_demo_event` with `load_started` and, after about one visible second,
   `exposed`. Click a demo card or source/docs link to check an actual user action.
4. Inspect the Google collection request's query parameters and body. Expected
   fields include `tid=G-E4T80WRJGS`, `en=superdoc_demo_event`,
   `ep.action`, `ep.example_id`, and the canonical `dl` page location. Requests can
   be batched. A successful response proves transport, not final report ingestion.
5. In the existing GA4 property's **Realtime** report, look for
   `superdoc_demo_event` under **Event count by event name**. Confirm the action
   and demo parameters where available. Growth uses completed days and a refreshed
   source observation, so it is not the immediate smoke-test surface.

For an optional synthetic smoke test, run this once in the gallery page's console
after consent and frame initialization:

```js
window.dispatchEvent(new CustomEvent('superdoc:demo', {
  detail: { action: 'ai_started', capability: 'ai' }
}));
```

On the gallery homepage the resulting event has `example_id=gallery`,
`page_id=demo_gallery` and `page_location=https://demos.superdoc.dev/`. This records
real production activity if transport is enabled; prefer a real click for routine
checks. Repeating the same demo/action/capability on one page instance is
deduplicated. Reload before another smoke test. `dispatchEvent` returning `true`
does not prove that analytics accepted or sent the event.

For temporary console inspection without changing production code, add a listener
that prints only the public categories:

```js
const logDemoEvent = ({ detail }) => console.log('superdoc:demo', {
  action: detail?.action,
  capability: detail?.capability,
  example: detail?.example ?? '(inferred from route)'
});
window.addEventListener('superdoc:demo', logDemoEvent);
// When finished:
// window.removeEventListener('superdoc:demo', logDemoEvent);
```

That listener confirms the local dispatch only; automatically observed clicks
and exposures call the adapter directly and do not dispatch `superdoc:demo`.
Use Network and GA4 Realtime to verify those. Unknown actions and extra properties
are discarded. Adding `debug_mode` to `detail` does not enable GA4 DebugView.
For automated QA, use `node --test scripts/demo-analytics.test.mjs`: its transport
is mocked and does not send synthetic activity to production.

## Every future published demo and example

Josh's November 15 direction applies to every future demo and example, including public customer follow-ups and launches outside this gallery. Before readiness, record the stable resource ID, canonical public destination, developer task, meaningful action and expected result, native social/video metrics where relevant, reporting coverage and collection start date. Reuse the existing consented GA4 transport, Growth Analytics and weekly metrics publisher.

For a gallery addition, CI executes the real adapter against every `demos.json` route and requires its stable ID plus consent/refusal behavior. A new manifest entry with no registered tracking fails the existing release tests. Update the adapter, isolated homepage frame allowlist and Growth labels/queries together, add actual readiness/success/failure callbacks and verify production ingestion after the normal reviewed releases. Never add a generic arbitrary-event or arbitrary-URL escape hatch to make coverage pass.

For a new public host or standalone example, prepare the same coverage through its owning repository and normal review before posting. A local quickstart or downloaded source example must remain free of analytics by default. Native video views, link clicks, example downloads and successful interactive actions are different measures. Unsupported platform metrics remain explicitly unavailable, never zero or invented. Do not alter old posts, customer links or private rooms to manufacture attribution. Follow the existing content worker's [future demo measurement standard](https://github.com/superdoc/sales-engine/blob/main/docs/demo-analytics.md#future-demos-and-examples).
