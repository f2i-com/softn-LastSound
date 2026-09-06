#!/usr/bin/env node
'use strict';
/**
 * Static checks on bundle/ that run without a browser or the SoftN engine:
 * the manifest names real files and every asset on disk; the single UI and
 * logic files parse structurally (the composer accepts them and every handler
 * a template binds is a function the logic defines); the voice manifest names
 * clips that exist and no clip is orphaned; audio and image files carry the
 * right magic bytes; the packed bundle stays under the runtime's remote limit.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { composeBundleSource } = require('../tools/bundle-source-composer.cjs');
const { packBundle, MAX_BYTES } = require('../tools/pack.cjs');

const root = path.resolve(__dirname, '..');
const bundle = path.join(root, 'bundle');
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok  ' + msg); else { failures++; console.error('  FAIL ' + msg); } };
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(path.join(dir, f.name)) : [path.join(dir, f.name)]));

const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
console.log(`${manifest.name} v${manifest.version}`);

// Manifest and assets agree exactly.
const listed = [manifest.main, manifest.icon, ...manifest.files.ui, ...manifest.files.logic, ...manifest.files.assets];
ok(listed.every((f) => !f.includes('..') && !path.isAbsolute(f) && fs.existsSync(path.join(bundle, f))), 'every file the manifest names exists inside bundle/');
const onDisk = walk(path.join(bundle, 'assets')).map((f) => path.relative(bundle, f).replace(/\\/g, '/')).sort();
ok(JSON.stringify(manifest.files.assets.slice().sort()) === JSON.stringify(onDisk), `manifest lists every asset on disk (${onDisk.length})`);
ok(JSON.parse(fs.readFileSync(path.join(bundle, 'permission.json'), 'utf8')).permissions && Object.keys(JSON.parse(fs.readFileSync(path.join(bundle, 'permission.json'), 'utf8')).permissions).length === 0, 'the game asks for no host permissions');

// The composed program is syntactically valid JavaScript and defines every bound handler.
const textFiles = new Map();
for (const f of [...manifest.files.ui, ...manifest.files.logic]) textFiles.set(f, fs.readFileSync(path.join(bundle, f), 'utf8'));
let composed = null;
try {
  composed = composeBundleSource(textFiles, manifest.main, manifest.files.logic);
  ok(true, 'the source composer accepts the UI and logic');
} catch (err) {
  ok(false, 'the source composer accepts the UI and logic: ' + err.message);
}
if (composed) {
  const code = manifest.files.logic.map((f) => fs.readFileSync(path.join(bundle, f), 'utf8')).join('\n');
  try {
    new vm.Script(code, { filename: 'main.logic' });
    ok(true, 'the logic parses as JavaScript');
  } catch (err) {
    ok(false, 'the logic parses as JavaScript: ' + err.message);
  }
  const ui = manifest.files.ui.map((f) => fs.readFileSync(path.join(bundle, f), 'utf8')).join('\n');
  const handlers = new Set([...ui.matchAll(/@\w+=\{(\w+)/g)].map((m) => m[1]));
  const missing = [...handlers].filter((h) => !new RegExp('function\\s+' + h + '\\s*\\(').test(code));
  ok(missing.length === 0, `every UI handler is a function the logic defines (${handlers.size} handlers${missing.length ? '; missing ' + missing.join(', ') : ''})`);
}

// Voice manifest and clips agree; media files are what their extensions claim.
const logicText = fs.readFileSync(path.join(bundle, manifest.files.logic[0]), 'utf8');
const voiceKeys = [...logicText.matchAll(/"((?:operator|vale|sen|archive|printer|system|unverified|arm|[a-z]+)_[0-9a-f]{8})":\s*\d+/g)].map((m) => m[1]);
const clips = fs.readdirSync(path.join(bundle, 'assets/voice')).map((f) => f.replace(/\.mp3$/, ''));
ok(voiceKeys.length > 0 && voiceKeys.every((k) => clips.includes(k)), `every voice line in the manifest has a clip (${voiceKeys.length} lines)`);
ok(clips.every((k) => voiceKeys.includes(k)), `no orphaned voice clip (${clips.length} clips)`);
const isMp3 = (b) => b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
ok(clips.every((k) => isMp3(fs.readFileSync(path.join(bundle, 'assets/voice', k + '.mp3')))), 'every voice clip is an MP3');
const wavs = walk(path.join(bundle, 'assets/sfx')).filter((f) => f.endsWith('.wav'));
ok(wavs.every((f) => fs.readFileSync(f).toString('ascii', 0, 4) === 'RIFF'), `every sound effect is a RIFF WAV (${wavs.length})`);
const pngs = walk(path.join(bundle, 'assets')).filter((f) => f.endsWith('.png'));
ok(pngs.every((f) => fs.readFileSync(f).readUInt32BE(0) === 0x89504e47), `every image is a PNG (${pngs.length})`);
const svgs = walk(path.join(bundle, 'assets')).filter((f) => f.endsWith('.svg'));
ok(svgs.every((f) => { const s = fs.readFileSync(f, 'utf8'); return /<svg\b/.test(s) && !/<(?:script|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']https?:|url\(\s*https?:/i.test(s); }), 'SVGs are self-contained (no scripts or external references)');

// The packed bundle stays under the web runtime's remote limit.
try {
  const { bytes, entries } = packBundle(bundle);
  ok(bytes.length < MAX_BYTES, `packed bundle is ${(bytes.length / 1048576).toFixed(2)} MB in ${entries} entries, under ${MAX_BYTES / 1048576} MB`);
} catch (err) {
  ok(false, 'the bundle packs: ' + err.message);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exitCode = failures ? 1 : 0;
