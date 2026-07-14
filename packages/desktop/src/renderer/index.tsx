import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { colors, CSS_VARIABLES, typography } from './theme';

window.addEventListener('error', (e) => {
  console.error('[renderer] uncaught error:', e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] unhandled promise rejection:', e.reason);
});

function shouldKeepPointerFocus(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  return (
    element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
    || element.isContentEditable
  );
}

document.addEventListener('pointerup', () => {
  const activeElement = document.activeElement;
  if (shouldKeepPointerFocus(activeElement)) {
    return;
  }
  if (activeElement instanceof HTMLElement) {
    activeElement.blur();
  }
});

// Inject CSS variables for the app theme
const style = document.createElement('style');
style.textContent = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  *:focus,
  *:focus-visible {
    outline: none !important;
    outline-offset: 0 !important;
  }
  button {
    appearance: none;
    -webkit-appearance: none;
    -webkit-tap-highlight-color: transparent;
  }
  button::-moz-focus-inner {
    border: 0;
  }
  button:focus,
  button:focus-visible,
  button:active {
    outline: none !important;
    outline-offset: 0 !important;
    box-shadow: none;
  }
  [role="button"] {
    -webkit-tap-highlight-color: transparent;
  }
  [role="button"]:focus,
  [role="button"]:focus-visible,
  [role="button"]:active {
    outline: none !important;
    outline-offset: 0 !important;
    box-shadow: none;
  }
  body {
    font-family: ${typography.fontFamily};
    background-color: ${colors.background};
    color: ${colors.text};
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  #root {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  ::-webkit-scrollbar-track {
    background: ${colors.background};
  }
  ::-webkit-scrollbar-thumb {
    background: ${colors.border};
    border-radius: 3px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: ${colors.accent};
  }
  ${CSS_VARIABLES}
`;
document.head.appendChild(style);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
