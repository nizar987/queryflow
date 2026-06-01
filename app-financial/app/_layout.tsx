import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useCallback } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { useAuthStore } from '@/store/authStore';
import { useSettingsStore } from '@/store/settingsStore';
import { Colors } from '@/constants/colors';

// Keep splash visible while we load resources
ExpoSplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();

  const initialize = useAuthStore((s) => s.initialize);
  const user = useAuthStore((s) => s.user);
  const isGuest = useAuthStore((s) => s.isGuest);
  const isPinVerified = useAuthStore((s) => s.isPinVerified);
  const authLoading = useAuthStore((s) => s.isLoading);

  const loadSettings = useSettingsStore((s) => s.load);
  const isOnboarded = useSettingsStore((s) => s.isOnboarded);
  const pinEnabled = useSettingsStore((s) => s.pinEnabled);
  const lastActive = useSettingsStore((s) => s.lastActive);
  const settingsLoading = useSettingsStore((s) => s.isLoading);

  const [fontsLoaded] = useFonts({
    Outfit: require('@/assets/fonts/Outfit-Bold.ttf'),
    'Outfit-SemiBold': require('@/assets/fonts/Outfit-SemiBold.ttf'),
    Inter: require('@/assets/fonts/Inter-Regular.ttf'),
    'Inter-Medium': require('@/assets/fonts/Inter-Medium.ttf'),
  });

  useEffect(() => {
    loadSettings();
    const unsubscribe = initialize();
    return unsubscribe;
  }, []);

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded && !settingsLoading && !authLoading) {
      await ExpoSplashScreen.hideAsync();
    }
  }, [fontsLoaded, settingsLoading, authLoading]);

  // Navigation guard: redirect based on auth/onboarding state
  useEffect(() => {
    if (settingsLoading || authLoading || !fontsLoaded) return;

    const inAuthGroup = (segments[0] as string) === '(auth)';
    const isAuthenticated = !!user || isGuest;

    if (!isOnboarded) {
      // Not onboarded -> go to welcome
      if (!inAuthGroup) {
        router.replace('/(auth)/welcome' as any);
      }
    } else if (isAuthenticated) {
      // Check if PIN is required: either explicitly enabled, or inactive for > 1 week
      const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      const isTokenExpired = Date.now() - lastActive > ONE_WEEK_MS;
      const requiresPin = (pinEnabled || isTokenExpired) && !isPinVerified;

      if (requiresPin) {
        if ((segments as string[])[1] !== 'pin-login') {
          router.replace('/(auth)/pin-login' as any);
        }
      } else {
        // Onboarded + authenticated + PIN verified (or not required) -> go to tabs
        if (inAuthGroup) {
          router.replace('/(tabs)' as any);
        }
      }
    } else {
      // Onboarded but not authenticated -> go to welcome (or login)
      if (!inAuthGroup) {
        router.replace('/(auth)/welcome' as any);
      }
    }
  }, [
    user,
    isGuest,
    isOnboarded,
    segments,
    settingsLoading,
    authLoading,
    fontsLoaded,
    pinEnabled,
    lastActive,
    isPinVerified,
  ]);

  // Show nothing while loading (splash screen stays visible)
  if (!fontsLoaded || settingsLoading || authLoading) {
    return (
      <View style={styles.loadingContainer} onLayout={onLayoutRootView}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen
          name="modals/add-transaction"
          options={{ presentation: 'modal' }}
        />
        <Stack.Screen
          name="modals/add-wallet"
          options={{ presentation: 'modal' }}
        />
        <Stack.Screen
          name="modals/add-goal"
          options={{ presentation: 'modal' }}
        />
      </Stack>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
