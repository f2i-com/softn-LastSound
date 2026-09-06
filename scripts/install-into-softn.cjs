#!/usr/bin/env node
'use strict';
/**
 * Install this game into an existing softn.com checkout for local play and testing.
 *
 *   node scripts/install-into-softn.cjs "C:\path\to\softn.com" [--dry-run] [--replace]
 *
 * Copies bundle/ to apps/demo/bundles/LastSound3D and the directory thumbnail,
 * makes sure the demo catalogue lists the game (adding the entry from site/ if it
 * is missing), and rebuilds with the checkout's own build-bundle.cjs, which also
 * refreshes the served copy and icon. Never clones, commits, pushes, deploys,
 * installs dependencies, or deletes saved data. `scripts/uninstall-from-softn.cjs`
 * reverses it.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const NAME = 'LastSound3D';
const OVERLAY = [
  { from: 'bundle', to: `apps/demo/bundles/${NAME}` },
  { from: 'site/thumbnail.webp', to: `apps/softn-web/public/demos/thumbs/${NAME}.webp` },
];

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? files(path.join(dir, f.name)) : [path.join(dir, f.name)]));
}
function plan() {
  const pairs = [];
  for (const item of OVERLAY) {
    const src = path.join(repo, item.from);
    if (!fs.existsSync(src)) continue;
    if (fs.statSync(src).isDirectory()) for (const f of files(src)) pairs.push({ src: f, rel: path.join(item.to, path.relative(src, f)) });
    else pairs.push({ src, rel: item.to });
  }
  return pairs;
}

try {
  const args = process.argv.slice(2), replace = args.includes('--replace'), dry = args.includes('--dry-run');
  const targets = args.filter((a) => !a.startsWith('--'));
  if (targets.length !== 1) throw Error('Usage: node scripts/install-into-softn.cjs "C:\\path\\to\\softn.com" [--dry-run] [--replace]');
  const root = fs.realpathSync(path.resolve(targets[0]));
  for (const f of ['apps/demo/scripts/build-bundle.cjs', 'apps/softn-web/public/demos/index.json']) {
    if (!fs.existsSync(path.join(root, f))) throw Error('Not a supported softn.com checkout; missing ' + f);
  }
  const pairs = plan(), conflicts = [];
  for (const p of pairs) {
    const dest = path.join(root, p.rel);
    if (fs.existsSync(dest) && (!fs.statSync(dest).isFile() || !fs.readFileSync(p.src).equals(fs.readFileSync(dest)))) conflicts.push(p.rel);
  }
  const indexPath = path.join(root, 'apps/softn-web/public/demos/index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const listed = index.some((e) => e && e.file === `${NAME}.softn`);
  console.log('Target: ' + root + '\nGame files: ' + pairs.length + (conflicts.length ? '\nDiffering files: ' + conflicts.length : '') + '\nCatalogue entry: ' + (listed ? 'present' : 'will be added from site/index-entry.json'));
  if (conflicts.length && !replace) throw Error('Existing files differ; nothing was changed. Use --replace to overwrite them (a backup is kept):\n' + conflicts.join('\n'));
  if (dry) { console.log('Dry run passed. Nothing changed.'); process.exit(0); }
  const backupRoot = path.join(root, '.last-sound-backup', 'replaced-' + new Date().toISOString().replace(/[:.]/g, '-'));
  for (const rel of conflicts) {
    const dest = path.join(backupRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, rel), dest);
  }
  // Files removed here must not linger there: the checkout's builder packs everything under assets/.
  const gameDir = path.join(root, `apps/demo/bundles/${NAME}`);
  if (replace && fs.existsSync(gameDir)) fs.rmSync(gameDir, { recursive: true, force: true });
  for (const p of pairs) {
    const dest = path.join(root, p.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(p.src, dest);
  }
  if (!listed) {
    index.push(JSON.parse(fs.readFileSync(path.join(repo, 'site/index-entry.json'), 'utf8')));
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
    console.log('Added the catalogue entry to demos/index.json (the API seeder reads the same list).');
  }
  const r = cp.spawnSync(process.execPath, [path.join(root, 'apps/demo/scripts/build-bundle.cjs'), NAME], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) throw Error('The checkout build failed.');
  console.log('\nInstalled and rebuilt. No remote repository or site was modified.');
  console.log(`Play: npm run dev:web in the checkout, then http://localhost:1420/?open=/demos/${NAME}.softn`);
} catch (err) {
  console.error('\nInstallation stopped: ' + err.message);
  process.exitCode = 1;
}
