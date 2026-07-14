import React from 'react';
import { AppRegistry } from 'react-native';
import { createRoot } from 'react-dom/client';
import App from '../src/App';
import { name as appName } from '../app.json';
import './previewBridge';
import './styles.css';

type WebAppRegistry = typeof AppRegistry & {
  getApplication: (
    appKey: string,
    options: { initialProps: Record<string, unknown> },
  ) => { element: React.ReactElement };
};

AppRegistry.registerComponent(appName, () => App);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Mobile web preview root element was not found.');
}

const { element } = (AppRegistry as WebAppRegistry).getApplication(appName, {
  initialProps: {},
});

createRoot(rootElement).render(
  <React.StrictMode>
    {element}
  </React.StrictMode>,
);
