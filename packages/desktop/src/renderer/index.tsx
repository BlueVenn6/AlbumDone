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
  :focus-visible { outline: 2px solid ${colors.accent} !important; outline-offset: 3px !important; }
  button, select, input { font: inherit; }
  button {
    padding: 10px 16px; border: 1px solid ${colors.border}; border-radius: 10px;
    background: ${colors.surface}; color: ${colors.text}; line-height: 1.45;
    cursor: pointer; white-space: normal; overflow-wrap: break-word;
    appearance: none;
    -webkit-appearance: none;
    -webkit-tap-highlight-color: transparent;
  }
  button:disabled { opacity: 0.55; cursor: default; }
  button.primary-action { background: ${colors.accent}; color: ${colors.textOnStrong}; border-color: ${colors.accent}; }
  p { line-height: 1.6; }
  button::-moz-focus-inner {
    border: 0;
  }
  button:focus:not(:focus-visible),
  button:active:not(:focus-visible) {
    outline: none !important;
    outline-offset: 0 !important;
    box-shadow: none;
  }
  [role="button"] {
    -webkit-tap-highlight-color: transparent;
  }
  [role="button"]:focus:not(:focus-visible),
  [role="button"]:active:not(:focus-visible) {
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
  @container (max-width: 740px) {
    .home-summary { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .home-summary > :first-child { display: none !important; }
    .home-summary > :nth-child(2) { grid-column: 1 / -1; }
    .home-summary > :nth-child(n+3) { padding-left: 0 !important; border-left: 0 !important; }
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
