/**
 * IPC channel definitions and payload validation.
 *
 * Every message flowing between main ↔ renderer is validated here with zod.
 * The preload script uses `contextBridge` to expose only these typed channels.
 */

import { z } from 'zod';

// ── Channel names ──────────────────────────────────────────────────

export const IpcChannels = {
  // Overlay wheel
  WHEEL_SHOW: 'wheel:show',
  WHEEL_HIDE: 'wheel:hide',
  WHEEL_HOVER: 'wheel:hover',
  WHEEL_DROP: 'wheel:drop',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_TAB: 'settings:tab',

  // Tray popup
  TRAY_ACTION: 'tray:action',

  // App launching
  LAUNCH_APP: 'launch:app',

  // Confirm dialog
  CONFIRM_RESPONSE: 'confirm:response',

  // Toast
  TOAST_DISMISS: 'toast:dismiss',

  // Prefs live updates (main → renderer broadcast)
  PREFS_CHANGED: 'prefs:changed',
  PREFS_REQUEST: 'prefs:request',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

// ── Payload schemas ────────────────────────────────────────────────

export const WedgeModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  iconDataUrl: z.string().optional(),
  badge: z.enum(['DEFAULT', 'PINNED']).optional(),
});

export type WedgeModel = z.infer<typeof WedgeModelSchema>;

export const WheelShowPayload = z.object({
  wedges: z.array(WedgeModelSchema),
  extensions: z.array(z.string()),
  fileCount: z.number().int().positive(),
  hintText: z.string(),
});

export const WheelHidePayload = z.object({
  reason: z.enum(['drop', 'cancel', 'escape', 'timeout']),
});

export const WheelHoverPayload = z.object({
  wedgeIndex: z.number().int().min(-1), // -1 = center / outside
  type: z.enum(['center', 'wedge', 'outside']),
});

export const WheelDropPayload = z.object({
  wedgeIndex: z.number().int().min(-1),
  appId: z.string(),
});

export const SettingsGetPayload = z.object({
  key: z.string().optional(), // omit = return all
});

export const SettingsSetPayload = z.object({
  key: z.string(),
  value: z.unknown(),
});

export const SettingsTabPayload = z.object({
  tab: z.string(),
});

export const TrayActionPayload = z.object({
  action: z.enum(['open-settings', 'pause', 'resume', 'quit', 'about']),
});

export const LaunchAppPayload = z.object({
  appId: z.string(),
  filePaths: z.array(z.string()).min(1),
  extension: z.string(),
});

export const ConfirmResponsePayload = z.object({
  dialogId: z.string(),
  confirmed: z.boolean(),
});

export const ToastDismissPayload = z.object({
  toastId: z.string(),
});

export const PrefsChangedPayload = z.object({
  prefs: z.record(z.unknown()),
});

// ── Payload map (channel → schema) ────────────────────────────────

export const PayloadSchemas: Record<string, z.ZodType> = {
  [IpcChannels.WHEEL_SHOW]: WheelShowPayload,
  [IpcChannels.WHEEL_HIDE]: WheelHidePayload,
  [IpcChannels.WHEEL_HOVER]: WheelHoverPayload,
  [IpcChannels.WHEEL_DROP]: WheelDropPayload,
  [IpcChannels.SETTINGS_GET]: SettingsGetPayload,
  [IpcChannels.SETTINGS_SET]: SettingsSetPayload,
  [IpcChannels.SETTINGS_TAB]: SettingsTabPayload,
  [IpcChannels.TRAY_ACTION]: TrayActionPayload,
  [IpcChannels.LAUNCH_APP]: LaunchAppPayload,
  [IpcChannels.CONFIRM_RESPONSE]: ConfirmResponsePayload,
  [IpcChannels.TOAST_DISMISS]: ToastDismissPayload,
  [IpcChannels.PREFS_CHANGED]: PrefsChangedPayload,
};

// ── Validation helper ──────────────────────────────────────────────

/**
 * Validate an incoming IPC payload. Returns the parsed data or throws.
 */
export function validateIpcPayload<T>(channel: string, data: unknown): T {
  const schema = PayloadSchemas[channel];
  if (!schema) {
    throw new Error(`Unknown IPC channel: ${channel}`);
  }
  return schema.parse(data) as T;
}

// ── contextBridge registration helper ──────────────────────────────

/**
 * Returns the shape of the API object that the preload script should
 * expose via `contextBridge.exposeInMainWorld('orbit', api)`.
 *
 * Renderer code calls `window.orbit.send(channel, data)` etc.
 * This is consumed by the preload — not called from main directly.
 */
export interface OrbitBridgeApi {
  send: (channel: IpcChannel, data?: unknown) => void;
  invoke: (channel: IpcChannel, data?: unknown) => Promise<unknown>;
  on: (channel: IpcChannel, callback: (data: unknown) => void) => () => void;
}

/**
 * The list of channels the renderer is allowed to send TO main.
 */
export const RENDERER_TO_MAIN_CHANNELS: readonly IpcChannel[] = [
  IpcChannels.SETTINGS_GET,
  IpcChannels.SETTINGS_SET,
  IpcChannels.SETTINGS_TAB,
  IpcChannels.TRAY_ACTION,
  IpcChannels.LAUNCH_APP,
  IpcChannels.CONFIRM_RESPONSE,
  IpcChannels.TOAST_DISMISS,
  IpcChannels.PREFS_REQUEST,
] as const;

/**
 * The list of channels main is allowed to send TO the renderer.
 */
export const MAIN_TO_RENDERER_CHANNELS: readonly IpcChannel[] = [
  IpcChannels.WHEEL_SHOW,
  IpcChannels.WHEEL_HIDE,
  IpcChannels.WHEEL_HOVER,
  IpcChannels.WHEEL_DROP,
  IpcChannels.PREFS_CHANGED,
] as const;
