import { symlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const source = process.env.SUPERDOC_LOCAL_SOURCE;
const output = process.env.SUPERDOC_LOCAL_ES;
if (!source || !output || !path.isAbsolute(source) || !path.isAbsolute(output)) throw new Error('Set absolute SUPERDOC_LOCAL_SOURCE and SUPERDOC_LOCAL_ES paths');
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const relative = path.relative(repository, output);
if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error('Local SuperDoc artifacts must stay outside the public demos repository');
if (process.env.SUPERDOC_RELEASE_CANONICAL_REQUIRED === '1') throw new Error('This local source build cannot be used for publication');
process.env.SUPERDOC_INTERNAL_ES_ONLY = '1';
process.env.SUPERDOC_V2_RUNTIME_MODE = 'source';
process.env.SUPERDOC_SKIP_DTS = '1';
process.env.SUPERDOC_PUBLIC_NPM_OUT_DIR = output;
const require = createRequire(path.join(source, 'package.json'));
const { loadConfigFromFile } = await import(pathToFileURL(require.resolve('vite')).href);

export default async (environment) => {
  const loaded = await loadConfigFromFile(environment, path.join(source, 'vite.config.js'), source);
  if (!loaded) throw new Error('The SuperDoc source build configuration could not be loaded');
  const base = loaded.config;
  return { ...base,
    plugins: [...base.plugins, { name: 'link-local-source-runtime', closeBundle() {
      const link = path.join(output, 'node_modules');
      if (!existsSync(link)) symlinkSync(path.join(source, 'node_modules'), link, 'dir');
    } }],
    build: { ...base.build, outDir: output, rollupOptions: { ...base.build.rollupOptions, input: {
      superdoc: 'src/public/index.ts', ui: 'src/public/ui.ts', 'ui-react': 'src/public/ui-react.ts',
    } } },
  };
};
