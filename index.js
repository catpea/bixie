#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { readdir, readFile, writeFile, mkdir, copyFile } from 'fs/promises';

import { createHash } from 'crypto';
import { createReadStream } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { parseFlags } from './parse-flags.js';

/*@_@*/

const flags = parseFlags();

if (!flags.positional.length || flags.help || flags.h) {
  console.log(`bixie <@_@> - quick infinite scroll webpage generator

Usage:
  bixie [options] <source-directory>

Options:
  --dist <path>       Output directory (default: ./dist)
  --title <text>      Page title (default: Media Gallery)
  --autoplay <bool>   Autoplay videos on scroll (default: true)
  --muted <bool>      Mute videos (default: false)
  --loop <bool>       Loop videos (default: true)
  --controls <bool>   Show video controls (default: true)
  --per-page <n>      Items loaded per scroll (default: 5)
  --threshold <n>     Visibility ratio to trigger autoplay (default: 0.5)
  --help              Show this help message

Examples:
  bixie ~/Downloads/memes
  bixie --dist ~/www/gallery --title "Robot Files" ~/media/robots
  bixie --muted --no-loop ~/media/clips

Source directory should contain images (jpg, png, gif, webp)
and/or videos (mp4, webm, ogg). Files are content-addressed
(renamed to their hash) in the output.

Note: browsers require muted for autoplay to work without
user interaction. Use --muted if autoplay is not working.`);
  process.exit(0);
}

const defaults = {
  title: 'Media Gallery',
  dist: './dist',
  ui: path.join(__dirname, 'ui'),
  autoplay: true,
  muted: false,
  loop: true,
  controls: true,
  'per-page': 5,
  threshold: 0.5,
};

const options = Object.assign(defaults, flags);

const sourceFilesDir = path.resolve(options.positional[0]);
const distLocation = path.resolve(options.dist);
const indexJsonLocation = path.join(distLocation, 'index.json');

console.log(sourceFilesDir);

const fileEntries = await readdir(sourceFilesDir, { withFileTypes: true });
const files = fileEntries.filter(e => e.isFile() && !e.name.startsWith('.')).map(e => e.name);
await mkdir(distLocation, { recursive: true });

const distFilesLocation = path.join(distLocation, 'files');




await mkdir(distFilesLocation, { recursive: true });

// Copy Files, Populate And Save Index
const index = {files:[]};
for ( const file of files ){
  const source = path.join(sourceFilesDir, file);
  const ext = path.extname(file);
  const name = (await contentAddressableName(source)) + ext;
  const dest = path.join(distFilesLocation, name);
  await copyFile(source, dest);
  index.files.push({ name, file, ext });
}
await writeFile(indexJsonLocation, JSON.stringify(index, null, 2), 'utf8');

// structure
const distIndexHtml = path.join(distLocation, 'index.html');
const sourceUserInterfaceFilesDir = path.resolve(options.ui);
const userInterfaceEntries = await readdir(sourceUserInterfaceFilesDir, { withFileTypes: true });
const userInterfaceFiles = userInterfaceEntries.filter(e => e.isFile() && !e.name.startsWith('.')).map(e => e.name);
for ( const userInterfaceFile of userInterfaceFiles ) await copyFile(path.join(sourceUserInterfaceFilesDir, userInterfaceFile), path.join(distLocation, userInterfaceFile));

let txt = await readFile(distIndexHtml, 'utf8');
txt = txt.replace(/<title>.*?<\/title>/s, `<title>${options.title}</title>`);

const config = JSON.stringify({
  autoplay: options.autoplay,
  muted: options.muted,
  loop: options.loop,
  controls: options.controls,
  perPage: options['per-page'],
  threshold: options.threshold,
});
txt = txt.replace(/const CONFIG = .*?;/, `const CONFIG = ${config};`);

await writeFile(distIndexHtml, txt, 'utf8');

console.log('Copied!')




// UTIL
function contentAddressableName(source, algorithm = 'sha256', encoding = 'hex') { // base64url
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const rs = createReadStream(source);
    rs.on('data', chunk => hash.update(chunk));
    rs.on('end', () => resolve(`${algorithm}-${hash.digest(encoding)}`));
    rs.on('error', reject);
  });
}
