import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execAsync = promisify(exec);

/**
 * SMART OUTLETS — local Geeni/Tuya plug control (no cloud, no credits).
 *
 * Delegates to smarthome/outlets.py (tinytuya) via the smarthome venv. All
 * control happens on the LAN; this class just shells out and parses the JSON.
 */
const PY = path.resolve('smarthome/.venv/Scripts/python.exe');
const SCRIPT = path.resolve('smarthome/outlets.py');

export class SmartHome {
  private async run(cmd: string, name = ''): Promise<any> {
    const args = name ? `${cmd} "${name.replace(/"/g, '')}"` : cmd;
    let stdout = '';
    try {
      ({ stdout } = await execAsync(`"${PY}" "${SCRIPT}" ${args}`, { timeout: 30_000 }));
    } catch (e: any) {
      // Python still prints its JSON error to stdout on handled failures.
      stdout = e?.stdout || '';
      if (!stdout) throw new Error(e?.message || 'outlet control failed');
    }
    const line = stdout.trim().split('\n').filter(Boolean).pop() || '{}';
    let json: any;
    try { json = JSON.parse(line); } catch { throw new Error(`bad outlet response: ${line.slice(0, 200)}`); }
    if (json.error) throw new Error(json.error);
    return json;
  }

  list() { return this.run('list'); }
  status(name: string) { return this.run('status', name); }
  on(name: string) { return this.run('on', name); }
  off(name: string) { return this.run('off', name); }
  toggle(name: string) { return this.run('toggle', name); }
}
