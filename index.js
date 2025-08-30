#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { readdir, readFile, writeFile, mkdir, copyFile } from 'fs/promises';

import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { parseFlags } from './parse-flags.js';

/*@_@*/

const flags = parseFlags();

const defaults = {
  title: 'Media Gallery',
  sleep: false,
  dist: './dist',
  ui: path.join(__dirname, 'ui'),
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


if(options.sleep){
  setTimeout(()=>{
    console.log('Sleeping!')
  }, 1000*60*60)
}
