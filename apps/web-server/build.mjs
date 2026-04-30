import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * esbuild script for the web server.
 * Handles Vite's `?raw` suffix as a plugin (reads file content as a string).
 */
import { build } from 'esbuild';

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
  '@open-codesign/animation',
  '@remotion/bundler',
  '@remotion/renderer',
  'better-sqlite3',
  '@mariozechner/pi-ai',
  '@mariozechner/pi-agent-core',
  'cors',
  'electron',
  'express',
  'multer',
  'remotion',
  'smol-toml',
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
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  // Allow esbuild to resolve workspace packages via the monorepo node_modules
  nodePaths: [join(__dirname, '../../node_modules'), join(__dirname, 'node_modules')],
});

// Copy builtin skill .md files to dist/builtin/ so import.meta.url path resolution works at runtime.
// loadBuiltinSkills() resolves './builtin/' relative to the bundle file (dist/index.js).
const skillsSrc = join(__dirname, '../../packages/core/src/skills/builtin');
const skillsDst = join(__dirname, 'dist/builtin');
mkdirSync(skillsDst, { recursive: true });
for (const entry of readdirSync(skillsSrc)) {
  if (extname(entry) === '.md') {
    copyFileSync(join(skillsSrc, entry), join(skillsDst, entry));
    console.log(`[build] copied skill: ${entry}`);
  }
}
