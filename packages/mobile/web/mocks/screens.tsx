import React from 'react';
import { View } from 'react-native';

export function enableScreens(): void {
  return undefined;
}

export function enableFreeze(): void {
  return undefined;
}

export function Screen({ children, style }: React.ComponentProps<typeof View>): React.JSX.Element {
  return <View style={style}>{children}</View>;
}

export function ScreenContainer({ children, style }: React.ComponentProps<typeof View>): React.JSX.Element {
  return <View style={style}>{children}</View>;
}

export function ScreenStack({ children, style }: React.ComponentProps<typeof View>): React.JSX.Element {
  return <View style={style}>{children}</View>;
}

export function ScreenStackHeaderConfig(): null {
  return null;
}

export function ScreenStackHeaderSubview(): null {
  return null;
}

export function FullWindowOverlay({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return <>{children}</>;
}

export default {
  enableScreens,
  enableFreeze,
  Screen,
  ScreenContainer,
  ScreenStack,
  ScreenStackHeaderConfig,
  ScreenStackHeaderSubview,
  FullWindowOverlay,
};
