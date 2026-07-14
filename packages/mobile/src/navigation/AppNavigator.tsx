import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Platform, TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { colors, typography, spacing, radius, shadows } from '../theme';
import { HomeScreen } from '../screens/HomeScreen';
import { DeduplicationScreen } from '../screens/DeduplicationScreen';
import { CullingScreen } from '../screens/CullingScreen';
import { ScreenshotScreen } from '../screens/ScreenshotScreen';
import { YearInReviewScreen } from '../screens/YearInReviewScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useTranslation } from '@photo-manager/shared';

export type HomeStackParamList = {
  Home: undefined;
  Deduplication: { albumId: string };
  Culling: { albumId: string };
  Screenshots: { albumId: string };
  YearInReview: { albumId: string };
};

export type RootTabParamList = {
  HomeStack: undefined;
  Settings: undefined;
};

type WebRouteName = keyof HomeStackParamList | 'Settings';
type WebRoute = {
  name: WebRouteName;
  params?: { albumId: string };
};

const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const Tab = createBottomTabNavigator<RootTabParamList>();

function TabIcon({
  emoji,
  label,
  focused,
}: {
  emoji: string;
  label: string;
  focused: boolean;
}) {
  return (
    <View style={styles.tabIcon}>
      <Text style={styles.tabEmoji}>{emoji}</Text>
      <Text style={[styles.tabLabel, focused && styles.tabLabelFocused]}>
        {label}
      </Text>
    </View>
  );
}

function HomeStackNavigator() {
  const { t } = useTranslation();

  return (
    <HomeStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontSize: typography.sizes.lg, fontWeight: '600' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <HomeStack.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: t('home.title'), headerShown: false }}
      />
      <HomeStack.Screen
        name="Deduplication"
        component={DeduplicationScreen}
        options={{ title: t('home.modes.dedup.title') }}
      />
      <HomeStack.Screen
        name="Culling"
        component={CullingScreen}
        options={{ title: t('home.modes.culling.title'), headerBackTitle: t('common.back') }}
      />
      <HomeStack.Screen
        name="Screenshots"
        component={ScreenshotScreen}
        options={{ title: t('home.modes.screenshots.title'), headerBackTitle: t('common.back') }}
      />
      <HomeStack.Screen
        name="YearInReview"
        component={YearInReviewScreen}
        options={{ title: t('yearInReview.title'), headerBackTitle: t('common.back') }}
      />
    </HomeStack.Navigator>
  );
}

function WebPreviewNavigator(): React.JSX.Element {
  const { t } = useTranslation();
  const [route, setRoute] = React.useState<WebRoute>({ name: 'Home' });

  const navigation = React.useMemo(() => {
    const navigate = (name: WebRouteName, params?: { albumId: string }) => {
      setRoute({ name, ...(params ? { params } : {}) });
    };

    return {
      navigate,
      goBack: () => setRoute({ name: 'Home' }),
      getParent: () => ({ navigate }),
    };
  }, []);

  const homeRoute = { name: 'Home' as const, params: undefined };
  const albumRoute = {
    name: route.name,
    params: route.params ?? { albumId: '__all__' },
  };

  const renderContent = () => {
    switch (route.name) {
      case 'Settings':
        return <SettingsScreen />;
      case 'Deduplication':
        return <DeduplicationScreen navigation={navigation as never} route={albumRoute as never} />;
      case 'Culling':
        return <CullingScreen navigation={navigation as never} route={albumRoute as never} />;
      case 'Screenshots':
        return <ScreenshotScreen navigation={navigation as never} route={albumRoute as never} />;
      case 'YearInReview':
        return <YearInReviewScreen navigation={navigation as never} route={albumRoute as never} />;
      case 'Home':
      default:
        return <HomeScreen navigation={navigation as never} route={homeRoute as never} />;
    }
  };

  return (
    <View style={styles.webRoot}>
      <View style={styles.webContent}>
        {route.name !== 'Home' && route.name !== 'Settings' && (
          <TouchableOpacity style={styles.webBackButton} onPress={() => setRoute({ name: 'Home' })}>
            <Text style={styles.webBackText}>{t('common.back')}</Text>
          </TouchableOpacity>
        )}
        {renderContent()}
      </View>
      <View style={styles.webTabBar}>
        <TouchableOpacity
          style={styles.webTabButton}
          onPress={() => setRoute({ name: 'Home' })}
          activeOpacity={0.7}
        >
          <TabIcon emoji="■" label={t('home.library')} focused={route.name !== 'Settings'} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.webTabButton}
          onPress={() => setRoute({ name: 'Settings' })}
          activeOpacity={0.7}
        >
          <TabIcon emoji="⚙" label={t('settings.title')} focused={route.name === 'Settings'} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function AppNavigator(): React.JSX.Element {
  const { t } = useTranslation();

  if (Platform.OS === 'web') {
    return <WebPreviewNavigator />;
  }

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
      }}
    >
      <Tab.Screen
        name="HomeStack"
        component={HomeStackNavigator}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji="■" label={t('home.library')} focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji="⚙" label={t('settings.title')} focused={focused} />
          ),
          headerShown: true,
          headerTitle: t('settings.title'),
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontSize: typography.sizes.lg, fontWeight: '600' },
          headerShadowVisible: false,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  webRoot: {
    flex: 1,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  webTabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    flexShrink: 0,
    paddingVertical: spacing.sm,
    ...shadows.sm,
  },
  webTabButton: {
    flex: 1,
    alignItems: 'center',
  },
  webContent: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  webBackButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    marginLeft: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  webBackText: {
    color: colors.text,
    fontSize: typography.sizes.sm,
    fontWeight: '600',
  },
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    height: 72,
    paddingBottom: spacing.sm,
    paddingTop: spacing.xs,
  },
  tabIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xs,
  },
  tabEmoji: {
    fontSize: 22,
    color: colors.accent,
  },
  tabLabel: {
    fontSize: typography.sizes.xs,
    color: colors.textTertiary,
    marginTop: 2,
  },
  tabLabelFocused: {
    color: colors.accent,
  },
});
