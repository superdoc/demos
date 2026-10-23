import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export function galleryVersion(html) {
  const version = html.match(/<p\s+class="site-version"\s*>SuperDoc v(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?=[\s<])/);
  if (!version) throw new Error("Gallery is missing its SuperDoc version label");
  return version[1];
}

export async function verifyProductionGallery({
  expectedHtml,
  fetchImpl = fetch,
  wait = sleep,
  attempts = 30,
  log = console.log,
}) {
  const expected = galleryVersion(expectedHtml);
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const url = new URL("https://demos.superdoc.dev/");
      url.searchParams.set("release-check", `${expected}-${Date.now()}-${attempt}`);
      const response = await fetchImpl(url, {
        headers: { "cache-control": "no-cache" },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Production gallery returned HTTP ${response.status}`);
      const actual = galleryVersion(await response.text());
      if (actual !== expected) throw new Error(`Production gallery serves SuperDoc ${actual}; expected ${expected}`);
      log(`Verified https://demos.superdoc.dev/ serves SuperDoc ${expected}`);
      return expected;
    } catch (error) {
      failure = error;
      log(`Production verification ${attempt}/${attempts}: ${error.message}`);
      if (attempt < attempts) await wait(10_000);
    }
  }
  throw new Error(`Production gallery verification failed: ${failure?.message}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyProductionGallery({ expectedHtml: await readFile("dist/index.html", "utf8") });
}
