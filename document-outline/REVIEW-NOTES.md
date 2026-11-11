# Document outline verification

The example uses SuperDoc 2.29.0 public APIs. Native Word heading discovery is the default. Optional detected section titles are application policy. No core library changes or unreleased outline controller are required.

Local verification:

- Production TypeScript and Vite build passed.
- Six native browser workflows passed in Chromium and six in WebKit, including duplicate heading destination visibility, local heading edits, mobile navigation and Word download preparation.
- The gallery smoke test passed without console errors.
- All 60 release automation tests passed.
- The copyable clone, npm install and npm run dev sequence passed in an isolated source checkout, including native rendering, copying the command and a production build.
- The rendered gallery contains the new card and usable route. Server HTML, public guide.md and llms.txt describe the public APIs without needing JavaScript.

The tests use synthetic DOCX fixtures generated with docx 9.7.1. Microsoft Word round trips and physical iPhone testing are not claimed. Files opened in the demo stay in browser memory. Only explicit export prepares a download.

## Screenshot provenance

Source: the native SuperDoc browser renderer running the synthetic Meridian project brief. Captured by Playwright in Chromium at a 1280 × 1000 CSS pixel viewport and deviceScaleFactor 3, with all outline branches expanded. The studio element is 1216 × 907 CSS pixels.

- `dist-landing/document-outline-poster.png`: lossless native master, 3648 × 2721 pixels. SHA256 `bdcc2645ccae2d0c8af23dd7a3eea7a3d4e63632c48575afd478aeb2f7e090e7`.
- `document-outline/public/preview.png`: 2400 × 1790 pixels, downsampled from that master for social metadata. SHA256 `995f6d8477f45bc63030bbe16ed805efa92196afafe6fcef6f5e3d5c5f73e671`.
- Mobile inspection used the same native fixture at 390 × 1000 CSS pixels and deviceScaleFactor 3. Its private test artifact is 1098 × 2784 pixels.

Desktop and mobile captures were visually inspected. Images contain synthetic content, with no enlarged low-resolution sources, reconstructed UI or private document data.
