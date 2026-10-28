/**
 * Launch coordination.
 *
 * Resolves the correct launch method, handles dangerous-file confirmation,
 * records usage on success, and shows error toasts on failure.
 */

import * as fs from 'node:fs';
import type { PlatformAdapter, LaunchResult } from '../../platform/interfaces';
import { recordUsage } from './history';
import { createToast, createConfirmDialog } from './popup-windows';
import { refreshCatalog } from './catalog';

// ── Types ──────────────────────────────────────────────────────────

export interface ResolvedApp {
  id: string;
  name: string;
  exePath: string | null;
  aumid: string | null;
  handlerId: string | null;
  args: string;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Launch an app with the given file paths.
 *
 * Resolution order:
 *   1. IAssocHandler (if handlerId is set)
 *   2. AUMID activation (if packaged/Store app)
 *   3. Exe spawn (if exePath exists)
 *   4. Open-with dialog (fallback for "__other__")
 */
export async function launchApp(
  app: ResolvedApp,
  filePaths: string[],
  extension: string,
  platform: PlatformAdapter,
): Promise<void> {
  // Special case: "Other app..." opens the system open-with dialog
  if (app.id === '__other__') {
    await launchOpenWithDialog(filePaths[0], platform);
    return;
  }

  // Check if exe still exists (for non-packaged apps)
  if (app.exePath && !fs.existsSync(app.exePath)) {
    showLaunchError(app.name, `Executable not found: ${app.exePath}`);
    // Refresh catalog since the app may have been uninstalled
    refreshCatalog();
    return;
  }

  // Check for dangerous file types
  const isDangerous = await checkDangerous(extension, filePaths, platform);
  if (isDangerous === 'cancelled') {
    return; // User declined to open
  }

  // Try launch methods in order of preference
  let result: LaunchResult;

  if (app.handlerId) {
    result = await tryInvokeHandler(app.handlerId, filePaths, platform);
  } else if (app.aumid) {
    result = await tryActivatePackaged(app.aumid, filePaths, platform);
  } else if (app.exePath) {
    result = await trySpawnExe(app.exePath, app.args, filePaths, platform);
  } else {
    showLaunchError(app.name, 'No launch method available for this app.');
    return;
  }

  if (result.success) {
    recordUsage(extension, app.id);
  } else {
    showLaunchError(app.name, result.error ?? 'Unknown error');
    // Refresh catalog in case the app state changed
    refreshCatalog();
  }
}

// ── Launch methods ─────────────────────────────────────────────────

async function tryInvokeHandler(
  handlerId: string,
  filePaths: string[],
  platform: PlatformAdapter,
): Promise<LaunchResult> {
  try {
    return await platform.appLauncher.invokeHandler(handlerId, filePaths);
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function tryActivatePackaged(
  aumid: string,
  filePaths: string[],
  platform: PlatformAdapter,
): Promise<LaunchResult> {
  try {
    return await platform.appLauncher.activatePackaged(aumid, filePaths);
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function trySpawnExe(
  exePath: string,
  argsTemplate: string,
  filePaths: string[],
  platform: PlatformAdapter,
): Promise<LaunchResult> {
  try {
    // Build the argument list from the template
    const args = buildArgs(argsTemplate, filePaths);
    const workingDir = filePaths[0]
      ? require('node:path').dirname(filePaths[0])
      : process.cwd();

    return await platform.appLauncher.spawnExe(exePath, args, workingDir);
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function launchOpenWithDialog(
  filePath: string,
  platform: PlatformAdapter,
): Promise<void> {
  try {
    const result = await platform.appLauncher.openWithDialog(filePath);
    if (!result.success) {
      showLaunchError('Open With', result.error ?? 'Dialog cancelled');
    }
  } catch (err) {
    showLaunchError('Open With', String(err));
  }
}

// ── Argument building ──────────────────────────────────────────────

/**
 * Expand an argument template:
 *   {file}   -> first file path
 *   {files}  -> all file paths (space-separated, quoted)
 *   {folder} -> parent directory of first file
 */
function buildArgs(template: string, filePaths: string[]): string[] {
  const pathMod = require('node:path') as typeof import('node:path');

  if (template.includes('{files}')) {
    const expanded = template.replace('{files}', filePaths.map((p) => `"${p}"`).join(' '));
    return parseArgString(expanded);
  }

  if (template.includes('{folder}')) {
    const folder = pathMod.dirname(filePaths[0]);
    const expanded = template.replace('{folder}', `"${folder}"`);
    return parseArgString(expanded);
  }

  if (template.includes('{file}')) {
    // For single-file templates, launch once per file
    const expanded = template.replace('{file}', `"${filePaths[0]}"`);
    return parseArgString(expanded);
  }

  // No template vars: append file paths
  return [...parseArgString(template), ...filePaths];
}

/**
 * Simple argument string parser (respects double quotes).
 */
function parseArgString(s: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;

  for (const ch of s) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ' ' && !inQuote) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

// ── Dangerous file check ───────────────────────────────────────────

async function checkDangerous(
  extension: string,
  filePaths: string[],
  platform: PlatformAdapter,
): Promise<'ok' | 'cancelled'> {
  const { getPrefs } = await import('./prefs.js');
  const prefs = getPrefs();

  if (!prefs.confirmDangerousOpen) {
    return 'ok';
  }

  const isDangerous = await platform.appLauncher.isDangerous(extension);
  if (!isDangerous) {
    return 'ok';
  }

  // Check MotW on the first file
  const hasMotw = await platform.appLauncher.hasMotw(filePaths[0]);
  if (!hasMotw) {
    return 'ok'; // Local file, no web mark
  }

  // Show confirmation dialog
  const confirmed = await createConfirmDialog({
    dialogId: `dangerous-${Date.now()}`,
    title: 'Security Warning',
    message: `This file type (${extension}) can be dangerous.`,
    detail: `The file "${require('node:path').basename(filePaths[0])}" was downloaded from the internet. Are you sure you want to open it?`,
    confirmLabel: 'Open Anyway',
    cancelLabel: 'Cancel',
  });

  return confirmed ? 'ok' : 'cancelled';
}

// ── Error toast ────────────────────────────────────────────────────

function showLaunchError(appName: string, error: string): void {
  createToast({
    toastId: `launch-error-${Date.now()}`,
    title: `Failed to open with ${appName}`,
    body: error,
    variant: 'error',
  });
}
