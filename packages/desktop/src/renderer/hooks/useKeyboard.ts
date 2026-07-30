import { useEffect, useCallback, useRef } from 'react';

type KeyboardAction = {
  key: string;
  ctrlOrCmd?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  handler: () => void;
};

type UseKeyboardOptions = {
  enabled?: boolean;
  preventDefault?: boolean;
};

/**
 * Register keyboard shortcuts for culling and navigation.
 *
 * Default culling shortcuts:
 * - ArrowLeft / A → delete
 * - ArrowRight / D → keep
 * - Delete / Backspace → delete
 * - Enter / Space → keep
 * - Cmd+Z / Ctrl+Z → undo
 * - Escape → go back / close
 */
export function useKeyboard(
  actions: KeyboardAction[],
  options: UseKeyboardOptions = {},
): void {
  const { enabled = true, preventDefault = true } = options;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Don't intercept events when typing in inputs
      const target = event.target as HTMLElement;
      const isInputFocused =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      if (isInputFocused) return;

      const isCtrlOrCmd = event.ctrlKey || event.metaKey;
      const isShift = event.shiftKey;
      const isAlt = event.altKey;

      for (const action of actionsRef.current) {
        const keyMatch = event.key === action.key;
        const ctrlMatch = !action.ctrlOrCmd || isCtrlOrCmd;
        const shiftMatch = !action.shift || isShift;
        const altMatch = !action.alt || isAlt;

        // For non-modifier shortcuts, ensure no unwanted modifiers are pressed
        const noUnwantedCtrl = action.ctrlOrCmd ? true : !isCtrlOrCmd;
        const noUnwantedShift = action.shift ? true : !isShift;
        const noUnwantedAlt = action.alt ? true : !isAlt;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch && noUnwantedCtrl && noUnwantedShift && noUnwantedAlt) {
          if (preventDefault) {
            event.preventDefault();
          }
          action.handler();
          return;
        }
      }
    },
    [enabled, preventDefault],
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);
}

// Pre-built culling shortcuts factory
export function buildCullingShortcuts(handlers: {
  onDelete: () => void;
  onKeep: () => void;
  onUndo: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onEscape?: () => void;
}): KeyboardAction[] {
  return [
    {
      key: 'ArrowLeft',
      description: 'Delete (ArrowLeft)',
      handler: handlers.onDelete,
    },
    {
      key: 'a',
      description: 'Delete (A)',
      handler: handlers.onDelete,
    },
    {
      key: 'ArrowRight',
      description: 'Keep (ArrowRight)',
      handler: handlers.onKeep,
    },
    {
      key: 'd',
      description: 'Keep (D)',
      handler: handlers.onKeep,
    },
    {
      key: 'ArrowUp',
      description: 'Previous (ArrowUp)',
      handler: handlers.onPrev ?? (() => {}),
    },
    {
      key: 'ArrowDown',
      description: 'Next (ArrowDown)',
      handler: handlers.onNext ?? (() => {}),
    },
    {
      key: 'Delete',
      description: 'Delete (Delete)',
      handler: handlers.onDelete,
    },
    {
      key: 'Backspace',
      description: 'Delete (Backspace)',
      handler: handlers.onDelete,
    },
    {
      key: 'Enter',
      description: 'Keep (Enter)',
      handler: handlers.onKeep,
    },
    {
      key: ' ',
      description: 'Keep (Space)',
      handler: handlers.onKeep,
    },
    {
      key: 'z',
      ctrlOrCmd: true,
      description: 'Undo (Cmd/Ctrl+Z)',
      handler: handlers.onUndo,
    },
    ...(handlers.onEscape
      ? [
          {
            key: 'Escape',
            description: 'Exit',
            handler: handlers.onEscape,
          },
        ]
      : []),
  ];
}

// Shortcut hint display helper
export function formatShortcut(action: KeyboardAction): string {
  const parts: string[] = [];
  if (action.ctrlOrCmd) {
    parts.push(navigator.platform.includes('Mac') ? '⌘' : 'Ctrl');
  }
  if (action.shift) parts.push('⇧');
  if (action.alt) parts.push(navigator.platform.includes('Mac') ? '⌥' : 'Alt');

  const keyLabel: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Enter: '↵',
    Escape: 'Esc',
    Delete: 'Del',
    Backspace: '⌫',
    ' ': 'Space',
  };

  parts.push(keyLabel[action.key] ?? action.key.toUpperCase());
  return parts.join('+');
}
