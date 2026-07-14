import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

type SafeAreaProps = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  edges?: string[];
};

type Metrics = {
  frame: { x: number; y: number; width: number; height: number };
  insets: { top: number; right: number; bottom: number; left: number };
};

type SafeAreaProviderProps = {
  children?: React.ReactNode;
  initialMetrics?: Metrics;
  style?: StyleProp<ViewStyle>;
};

function getWindowSize() {
  return {
    width: typeof window !== 'undefined' ? window.innerWidth : 390,
    height: typeof window !== 'undefined' ? window.innerHeight : 844,
  };
}

export function SafeAreaView({ children, style }: SafeAreaProps): React.JSX.Element {
  return <View style={style}>{children}</View>;
}

export function useSafeAreaInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function useSafeAreaFrame() {
  const { width, height } = getWindowSize();
  return { x: 0, y: 0, width, height };
}

const { width, height } = getWindowSize();
export const initialWindowMetrics: Metrics = {
  frame: { x: 0, y: 0, width, height },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
};

export const SafeAreaInsetsContext = React.createContext(initialWindowMetrics.insets);
export const SafeAreaFrameContext = React.createContext(initialWindowMetrics.frame);

export function SafeAreaProvider({
  children,
  initialMetrics = initialWindowMetrics,
  style,
}: SafeAreaProviderProps): React.JSX.Element {
  return (
    <SafeAreaFrameContext.Provider value={initialMetrics.frame}>
      <SafeAreaInsetsContext.Provider value={initialMetrics.insets}>
        <View style={[styles.provider, style]}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </SafeAreaFrameContext.Provider>
  );
}

const styles = StyleSheet.create({
  provider: {
    flex: 1,
  },
});
