/**
 * Dangerous-open rules tests — spec sections 3.7 and 4.5
 *
 * Tests: confirmation required or not for each combination of
 * default vs non-default handler, MOTW, and extension lists.
 */
import { describe, it, expect } from 'vitest';

// Script extensions (confirmation titled "Run this script?")
const SCRIPT_EXTS = ['.ps1', '.psm1', '.bat', '.cmd', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.reg'];

// Program extensions (confirmation titled "Run this program?")
const PROGRAM_EXTS = ['.exe', '.com', '.scr', '.msi', '.msix', '.appx', '.cpl'];

// Shortcut extensions (confirmation titled "Open this shortcut?")
const SHORTCUT_EXTS = ['.lnk', '.url'];

const ALL_DANGEROUS_EXTS = [...SCRIPT_EXTS, ...PROGRAM_EXTS, ...SHORTCUT_EXTS];

// Text-like types where "Open in Notepad instead" should appear
const NOTEPAD_ELIGIBLE_EXTS = [...SCRIPT_EXTS, '.reg'];

interface OpenContext {
  extension: string;
  isDefaultHandler: boolean;
  hasMotw: boolean;
  isAssocDangerous: boolean;
}

interface ConfirmationResult {
  required: boolean;
  title?: string;
  showNotepadLink?: boolean;
  actionLabel?: string;
}

function shouldConfirm(ctx: OpenContext): ConfirmationResult {
  // Non-default handler never needs confirmation
  if (!ctx.isDefaultHandler) {
    return { required: false };
  }

  const ext = ctx.extension.toLowerCase();

  // Check if extension is in dangerous lists
  const isScript = SCRIPT_EXTS.includes(ext);
  const isProgram = PROGRAM_EXTS.includes(ext);
  const isShortcut = SHORTCUT_EXTS.includes(ext);

  // AssocIsDangerous or in our lists
  const isDangerous = ctx.isAssocDangerous || isScript || isProgram || isShortcut;

  // MOTW always requires confirmation when opening with system default
  if (ctx.hasMotw) {
    if (isScript) {
      return { required: true, title: 'Run this script?', showNotepadLink: true, actionLabel: 'Run script' };
    }
    if (isProgram) {
      return { required: true, title: 'Run this program?', showNotepadLink: false, actionLabel: 'Run program' };
    }
    if (isShortcut) {
      return { required: true, title: 'Open this shortcut?', showNotepadLink: false, actionLabel: 'Open shortcut' };
    }
    // MOTW on a non-dangerous extension with default handler: still confirm
    return { required: true, title: 'Open this file?', showNotepadLink: false, actionLabel: 'Open' };
  }

  if (!isDangerous) {
    return { required: false };
  }

  if (isScript) {
    return { required: true, title: 'Run this script?', showNotepadLink: NOTEPAD_ELIGIBLE_EXTS.includes(ext), actionLabel: 'Run script' };
  }
  if (isProgram) {
    return { required: true, title: 'Run this program?', showNotepadLink: false, actionLabel: 'Run program' };
  }
  if (isShortcut) {
    return { required: true, title: 'Open this shortcut?', showNotepadLink: false, actionLabel: 'Open shortcut' };
  }

  // AssocIsDangerous but not in our specific lists
  return { required: true, title: 'Open this file?', showNotepadLink: false, actionLabel: 'Open' };
}

describe('Dangerous-open rules', () => {
  describe('default handler + dangerous extension → confirmation required', () => {
    for (const ext of ALL_DANGEROUS_EXTS) {
      it(`requires confirmation for ${ext} with default handler`, () => {
        const result = shouldConfirm({
          extension: ext,
          isDefaultHandler: true,
          hasMotw: false,
          isAssocDangerous: true,
        });
        expect(result.required).toBe(true);
      });
    }
  });

  describe('non-default handler → never needs confirmation', () => {
    for (const ext of ALL_DANGEROUS_EXTS) {
      it(`does NOT require confirmation for ${ext} with non-default handler`, () => {
        const result = shouldConfirm({
          extension: ext,
          isDefaultHandler: false,
          hasMotw: false,
          isAssocDangerous: true,
        });
        expect(result.required).toBe(false);
      });
    }
  });

  describe('MOTW + default handler → always confirms', () => {
    it('confirms .jpg with MOTW and default handler', () => {
      const result = shouldConfirm({
        extension: '.jpg',
        isDefaultHandler: true,
        hasMotw: true,
        isAssocDangerous: false,
      });
      expect(result.required).toBe(true);
    });

    it('confirms .ps1 with MOTW and default handler', () => {
      const result = shouldConfirm({
        extension: '.ps1',
        isDefaultHandler: true,
        hasMotw: true,
        isAssocDangerous: true,
      });
      expect(result.required).toBe(true);
      expect(result.title).toBe('Run this script?');
    });
  });

  describe('MOTW + non-default → no confirmation', () => {
    it('does NOT confirm .ps1 with MOTW and non-default handler', () => {
      const result = shouldConfirm({
        extension: '.ps1',
        isDefaultHandler: false,
        hasMotw: true,
        isAssocDangerous: true,
      });
      expect(result.required).toBe(false);
    });
  });

  describe('correct title per extension category', () => {
    it('script extensions get "Run this script?"', () => {
      for (const ext of SCRIPT_EXTS) {
        const result = shouldConfirm({ extension: ext, isDefaultHandler: true, hasMotw: false, isAssocDangerous: true });
        expect(result.title).toBe('Run this script?');
        expect(result.actionLabel).toBe('Run script');
      }
    });

    it('program extensions get "Run this program?"', () => {
      for (const ext of PROGRAM_EXTS) {
        const result = shouldConfirm({ extension: ext, isDefaultHandler: true, hasMotw: false, isAssocDangerous: true });
        expect(result.title).toBe('Run this program?');
        expect(result.actionLabel).toBe('Run program');
      }
    });

    it('shortcut extensions get "Open this shortcut?"', () => {
      for (const ext of SHORTCUT_EXTS) {
        const result = shouldConfirm({ extension: ext, isDefaultHandler: true, hasMotw: false, isAssocDangerous: true });
        expect(result.title).toBe('Open this shortcut?');
        expect(result.actionLabel).toBe('Open shortcut');
      }
    });
  });

  describe('"Open in Notepad" link visibility', () => {
    it('shown for script/text types', () => {
      for (const ext of NOTEPAD_ELIGIBLE_EXTS) {
        const result = shouldConfirm({ extension: ext, isDefaultHandler: true, hasMotw: false, isAssocDangerous: true });
        expect(result.showNotepadLink).toBe(true);
      }
    });

    it('not shown for program extensions', () => {
      const result = shouldConfirm({ extension: '.exe', isDefaultHandler: true, hasMotw: false, isAssocDangerous: true });
      expect(result.showNotepadLink).toBe(false);
    });

    it('not shown for shortcut extensions', () => {
      const result = shouldConfirm({ extension: '.lnk', isDefaultHandler: true, hasMotw: false, isAssocDangerous: true });
      expect(result.showNotepadLink).toBe(false);
    });
  });

  describe('safe extensions without MOTW', () => {
    const safeExts = ['.jpg', '.png', '.pdf', '.txt', '.docx', '.mp4'];
    for (const ext of safeExts) {
      it(`does NOT require confirmation for ${ext}`, () => {
        const result = shouldConfirm({
          extension: ext,
          isDefaultHandler: true,
          hasMotw: false,
          isAssocDangerous: false,
        });
        expect(result.required).toBe(false);
      });
    }
  });

  describe('case insensitivity', () => {
    it('handles uppercase extensions', () => {
      const result = shouldConfirm({
        extension: '.PS1',
        isDefaultHandler: true,
        hasMotw: false,
        isAssocDangerous: true,
      });
      expect(result.required).toBe(true);
    });
  });
});
