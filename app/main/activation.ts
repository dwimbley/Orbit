/**
 * Activation state machine.
 *
 * States:
 *   idle      - waiting for native hook events
 *   pending   - drag detected, waiting for delay / modifier confirmation
 *   surface   - invisible drop surface shown, waiting for OLE DragEnter
 *   confirmed - wheel visible, handling drag-over and drops
 *   hidden    - wheel dismissed for this drag session
 *
 * Transitions are driven by hook events and drop-target events.
 */

export type ActivationState = 'idle' | 'pending' | 'surface' | 'confirmed' | 'hidden';

export type ActivationEvent =
  | { type: 'DRAG_START'; cursorX: number; cursorY: number }
  | { type: 'DELAY_ELAPSED' }
  | { type: 'MODIFIER_PRESSED' }
  | { type: 'DRAG_ENTER'; items: DropEntryInfo[] }
  | { type: 'DRAG_OVER'; cursorX: number; cursorY: number }
  | { type: 'DROP'; wedgeIndex: number }
  | { type: 'DRAG_LEAVE' }
  | { type: 'DRAG_END' }
  | { type: 'ESCAPE' }
  | { type: 'DISMISS' };

export interface DropEntryInfo {
  path: string;
  isFolder: boolean;
  extension: string;
  displayName: string;
}

export interface ActivationContext {
  onShowSurface: (cursorX: number, cursorY: number) => void;
  onShowWheel: (items: DropEntryInfo[]) => void;
  onHideWheel: (reason: string) => void;
  onHoverUpdate: (cursorX: number, cursorY: number) => void;
  onDrop: (wedgeIndex: number) => void;
  onReset: () => void;
}

export interface ActivationMachine {
  readonly state: ActivationState;
  send: (event: ActivationEvent) => void;
  reset: () => void;
}

/**
 * Create the activation state machine.
 */
export function createActivationMachine(ctx: ActivationContext): ActivationMachine {
  let state: ActivationState = 'idle';
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPendingTimer(): void {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function transition(event: ActivationEvent): void {
    switch (state) {
      case 'idle':
        if (event.type === 'DRAG_START') {
          state = 'pending';
          // The caller (index.ts) decides whether to start the delay timer
          // or wait for a modifier, then sends DELAY_ELAPSED / MODIFIER_PRESSED.
        }
        break;

      case 'pending':
        if (event.type === 'DELAY_ELAPSED' || event.type === 'MODIFIER_PRESSED') {
          state = 'surface';
          // Show the invisible drop surface at the last known cursor position
          if (event.type === 'DELAY_ELAPSED') {
            // cursorX/cursorY are stored by the caller
            ctx.onShowSurface(0, 0); // caller provides real coords
          } else {
            ctx.onShowSurface(0, 0);
          }
        } else if (event.type === 'DRAG_END') {
          state = 'idle';
          clearPendingTimer();
          ctx.onReset();
        }
        break;

      case 'surface':
        if (event.type === 'DRAG_ENTER') {
          state = 'confirmed';
          ctx.onShowWheel(event.items);
        } else if (event.type === 'DRAG_LEAVE' || event.type === 'DRAG_END') {
          state = 'idle';
          ctx.onReset();
        } else if (event.type === 'ESCAPE' || event.type === 'DISMISS') {
          state = 'hidden';
          ctx.onHideWheel('escape');
        }
        break;

      case 'confirmed':
        if (event.type === 'DRAG_OVER') {
          ctx.onHoverUpdate(event.cursorX, event.cursorY);
        } else if (event.type === 'DROP') {
          ctx.onDrop(event.wedgeIndex);
          state = 'idle';
          ctx.onReset();
        } else if (event.type === 'DRAG_LEAVE') {
          state = 'idle';
          ctx.onHideWheel('cancel');
          ctx.onReset();
        } else if (event.type === 'DRAG_END') {
          // The mouse hook fires button-up BEFORE the OLE Drop callback arrives.
          // Delay the reset briefly to give Drop a chance to fire.
          setTimeout(() => {
            if (state === 'confirmed') {
              // No DROP arrived — the user released outside a wedge
              state = 'idle';
              ctx.onHideWheel('cancel');
              ctx.onReset();
            }
          }, 150);
        } else if (event.type === 'ESCAPE' || event.type === 'DISMISS') {
          state = 'hidden';
          ctx.onHideWheel('escape');
        }
        break;

      case 'hidden':
        // Stay hidden until the current drag session ends
        if (event.type === 'DRAG_END') {
          state = 'idle';
          ctx.onReset();
        }
        break;
    }
  }

  function reset(): void {
    clearPendingTimer();
    state = 'idle';
  }

  return {
    get state() {
      return state;
    },
    send: transition,
    reset,
  };
}
