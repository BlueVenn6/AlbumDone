export * from 'react-native-web';

export {
  default as AccessibilityInfo,
} from 'react-native-web/dist/exports/AccessibilityInfo';
export { default as ActivityIndicator } from 'react-native-web/dist/exports/ActivityIndicator';
export { default as Alert } from './webAlert';
export { default as Animated } from 'react-native-web/dist/exports/Animated';
export { default as AppRegistry } from 'react-native-web/dist/exports/AppRegistry';
export { default as AppState } from 'react-native-web/dist/exports/AppState';
export { default as BackHandler } from 'react-native-web/dist/exports/BackHandler';
export { default as Button } from 'react-native-web/dist/exports/Button';
export { default as Dimensions } from 'react-native-web/dist/exports/Dimensions';
export { default as FlatList } from 'react-native-web/dist/exports/FlatList';
export { default as Image } from 'react-native-web/dist/exports/Image';
export { default as I18nManager } from './webI18nManager';
export { default as Keyboard } from 'react-native-web/dist/exports/Keyboard';
export { default as Linking } from 'react-native-web/dist/exports/Linking';
export { default as Modal } from 'react-native-web/dist/exports/Modal';
export { default as NativeModules } from './webNativeModules';
export { default as Platform } from './webPlatform';
export { default as Pressable } from 'react-native-web/dist/exports/Pressable';
export { default as ScrollView } from 'react-native-web/dist/exports/ScrollView';
export { default as Share } from 'react-native-web/dist/exports/Share';
export { default as StatusBar } from 'react-native-web/dist/exports/StatusBar';
export { default as StyleSheet } from 'react-native-web/dist/exports/StyleSheet';
export { default as Text } from 'react-native-web/dist/exports/Text';
export { default as TextInput } from 'react-native-web/dist/exports/TextInput';
export { default as TouchableOpacity } from 'react-native-web/dist/exports/TouchableOpacity';
export { default as TouchableWithoutFeedback } from 'react-native-web/dist/exports/TouchableWithoutFeedback';
export { default as View } from 'react-native-web/dist/exports/View';

export const PermissionsAndroid = {
  PERMISSIONS: {
    READ_EXTERNAL_STORAGE: 'android.permission.READ_EXTERNAL_STORAGE',
    READ_MEDIA_IMAGES: 'android.permission.READ_MEDIA_IMAGES',
    READ_MEDIA_VISUAL_USER_SELECTED: 'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  },
  RESULTS: {
    GRANTED: 'granted',
    DENIED: 'denied',
    NEVER_ASK_AGAIN: 'never_ask_again',
  },
  check: async () => true,
  request: async () => 'granted',
  requestMultiple: async (permissions: string[]) =>
    Object.fromEntries(permissions.map((permission) => [permission, 'granted'])),
};
