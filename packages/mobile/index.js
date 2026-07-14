import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { name as appName } from './app.json';

// Zustand reads localStorage while App modules are initialized. Install the
// React Native persistent adapter before requiring App and its shared stores.
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = AsyncStorage;
}

const App = require('./src/App').default;

AppRegistry.registerComponent(appName, () => App);
