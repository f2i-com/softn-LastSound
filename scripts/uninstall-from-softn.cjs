#!/usr/bin/env node
'use strict';
/**
 * Remove this game from a softn.com checkout again.
 *
 *   node scripts/uninstall-from-softn.cjs "C:\path\to\softn.com" [--dry-run]
 *
 * Deletes the game's own files, drops its catalogue entry, and restores anything the
 * installer backed up. Saved data in the browser and any other change in the
 * checkout are left alone. If the checkout tracks the game in git, `git checkout --`
 * brings it back.
 */
const fs = require('node:fs');
const path = require('node:path');

const NAME = 'LastSound3D';
const GAME_PATHS = [
  `apps/demo/bundles/${NAME}`,
  `apps/demo/bundles/${NAME}.softn`,
  `apps/softn-web/public/demos/${NAME}.softn`,
  `apps/softn-web/public/demos/icons/${NAME}.svg`,
  `apps/softn-web/public/demos/thumbs/${NAME}.webp`,
];

try {
  const args = process.argv.slice(2), dry = args.includes('--dry-run');
  const targets = args.filter((a) => !a.startsWith('--'));
  if (targets.length !== 1) throw Error('Usage: node scripts/uninstall-from-softn.cjs "C:\\path\\to\\softn.com" [--dry-run]');
  const root = fs.realpathSync(path.resolve(targets[0]));
  if (!fs.existsSync(path.join(root, 'apps/demo/scripts/build-bundle.cjs'))) throw Error('Not a softn.com checkout: ' + root);
  const present = GAME_PATHS.filter((p) => fs.existsSync(path.join(root, p)));
  console.log('Target: ' + root + '\nGame files to remove: ' + (present.join(', ') || '(none)'));
  if (dry) { console.log('Dry run. Nothing changed.'); process.exit(0); }
  for (const p of present) fs.rmSync(path.join(root, p), { recursive: true, force: true });
  const indexPath = path.join(root, 'apps/softn-web/public/demos/index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const kept = index.filter((e) => !(e && e.file === `${NAME}.softn`));
  if (kept.length !== index.length) { fs.writeFileSync(indexPath, JSON.stringify(kept, null, 2) + '\n'); console.log('Dropped the catalogue entry from demos/index.json'); }
  const backup = path.join(root, '.last-sound-backup');
  if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  console.log('\nRemoved. Nothing else in the checkout was touched.');
} catch (err) {
  console.error('\nRemoval stopped: ' + err.message);
  process.exitCode = 1;
}
