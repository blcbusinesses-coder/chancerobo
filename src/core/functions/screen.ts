import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';

const execAsync = promisify(exec);

/**
 * SCREEN CAPTURE (Windows)
 * ------------------------
 * Captures the whole virtual screen (all monitors) to a PNG using .NET via
 * PowerShell — no native npm dependency. Returns the file path.
 */
export async function captureScreen(outPath?: string): Promise<string> {
  const file = outPath ?? path.join(tmpdir(), `chance_screen_${process.pid}_${Date.now()}.png`);
  const target = file.replace(/\\/g, '/'); // .NET accepts forward slashes on Windows

  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
    '$vs=[System.Windows.Forms.SystemInformation]::VirtualScreen;',
    '$bmp=New-Object System.Drawing.Bitmap $vs.Width,$vs.Height;',
    '$g=[System.Drawing.Graphics]::FromImage($bmp);',
    '$g.CopyFromScreen($vs.Location,[System.Drawing.Point]::Empty,$vs.Size);',
    `$bmp.Save('${target}',[System.Drawing.Imaging.ImageFormat]::Png);`,
    '$g.Dispose();$bmp.Dispose();',
  ].join(' ');

  await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`, {
    timeout: 20_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return file;
}
