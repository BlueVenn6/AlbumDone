import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

export function GestureHandlerRootView({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return <View style={style}>{children}</View>;
}
