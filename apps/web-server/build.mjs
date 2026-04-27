/**
 * esbuild script for the web server.
 * Handles Vite's `?raw` suffix as a plugin (reads file content as a string).
 */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const rawPlugin = {
  name: 'raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => {
      const realPath = args.path.replace(/\?raw$/, '');
      const resolved = join(dirname(args.importer), realPath);
      return { path: resolved, namespace: 'raw' };
    });
    build.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => {
      const content = readFileSync(args.path, 'utf8');
      return { contents: `export default ${JSON.stringify(content)}`, loader: 'js' };
    });
  },
};

// Mark all non-bundleable packages as external (native modules + unresolvable dynamic imports)
const EXTERNAL = [
  'better-sqlite3',
  '@mariozechner/pi-ai',
  '@mariozechner/pi-agent-core',
  'electron',
];

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/index.js',
  external: EXTERNAL,
  plugins: [rawPlugin],
  sourcemap: true,
  logLevel: 'info',
  // Allow esbuild to resolve workspace packages via the monorepo node_modules
  nodePaths: [
    join(__dirname, '../../node_modules'),
    join(__dirname, 'node_modules'),
  ],
});
