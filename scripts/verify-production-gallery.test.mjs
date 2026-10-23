import assert from "node:assert/strict";
import test from "node:test";
import { galleryVersion, verifyProductionGallery } from "./verify-production-gallery.mjs";

const html = (version) => `<p class="site-version">SuperDoc v${version} (latest)</p>`;
const options = { expectedHtml: html("2.26.0"), wait: async () => {}, log: () => {} };

test("verification checks the public production domain against the built version", async () => {
  const result = await verifyProductionGallery({ ...options, fetchImpl: async (url, request) => {
    assert.equal(url.origin, "https://demos.superdoc.dev");
    assert.equal(url.pathname, "/");
    assert.match(url.searchParams.get("release-check"), /^2\.26\.0-/);
    assert.equal(request.headers["cache-control"], "no-cache");
    assert.equal(request.redirect, "error");
    assert.ok(request.signal instanceof AbortSignal);
    return new Response(html("2.26.0"));
  } });
  assert.equal(result, "2.26.0");
});

test("a successful upload with stale production fails verification", async () => {
  let calls = 0;
  await assert.rejects(verifyProductionGallery({ ...options, attempts: 2, fetchImpl: async () => {
    calls++;
    return new Response(html("2.25.0"));
  } }), /serves SuperDoc 2\.25\.0; expected 2\.26\.0/);
  assert.equal(calls, 2);
});

test("verification waits for propagation and recovers from temporary failures", async () => {
  let calls = 0;
  let waits = 0;
  await verifyProductionGallery({ ...options, attempts: 4, wait: async (ms) => {
    assert.equal(ms, 10_000);
    waits++;
  }, fetchImpl: async () => {
    calls++;
    if (calls === 1) throw new Error("network timeout");
    if (calls === 2) return new Response("Unavailable", { status: 503 });
    return new Response(html(calls === 3 ? "2.25.0" : "2.26.0"));
  } });
  assert.equal(calls, 4);
  assert.equal(waits, 3);
});

test("error pages and missing version labels cannot pass verification", async () => {
  for (const response of [new Response(html("2.26.0"), { status: 404 }), new Response("SuperDoc v2.26.0")]) {
    await assert.rejects(verifyProductionGallery({ ...options, attempts: 1, fetchImpl: async () => response }), /verification failed/);
  }
  assert.throws(() => galleryVersion("<html>no version</html>"), /missing/);
});

test("a malformed build fails before contacting production", async () => {
  await assert.rejects(verifyProductionGallery({ ...options, expectedHtml: "", fetchImpl: () => assert.fail("Invalid build must fail first") }), /missing/);
});
