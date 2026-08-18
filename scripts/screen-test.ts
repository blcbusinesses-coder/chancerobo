import { promises as fs } from 'node:fs';
import { captureScreen } from '../src/core/functions/screen.js';

const file = await captureScreen();
const stat = await fs.stat(file);
console.log(`[screen:test] captured ${file} — ${Math.round(stat.size / 1024)} KB`);
