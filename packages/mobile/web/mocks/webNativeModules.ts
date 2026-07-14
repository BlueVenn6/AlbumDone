import UIManager from 'react-native-web/dist/exports/UIManager';

const NativeModules = {
  UIManager,
  SettingsManager: {
    settings: {
      AppleLocale: navigator.language ?? 'en',
      AppleLanguages: [navigator.language ?? 'en'],
    },
  },
  RNLocalize: {
    locale: navigator.language ?? 'en',
    locales: [navigator.language ?? 'en'],
  },
};

export default NativeModules;
