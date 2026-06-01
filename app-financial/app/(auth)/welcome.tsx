import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
  Dimensions,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { useSettingsStore } from '@/store/settingsStore';
import { Colors } from '@/constants/colors';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_HEIGHT * 0.45;

// Asset
const heroImage = require('@/assets/images/welcome-hero.png');

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signInAsGuest = useAuthStore((s) => s.signInAsGuest);
  const updateSettings = useSettingsStore((s) => s.update);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const buttonFadeAnim = useRef(new Animated.Value(0)).current;
  const buttonSlideAnim = useRef(new Animated.Value(20)).current;
  const glowPulse = useRef(new Animated.Value(0.2)).current;

  // Ambient glow positions
  const topGlowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Staggered entry animations
    Animated.sequence([
      Animated.delay(300),
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    Animated.sequence([
      Animated.delay(600),
      Animated.parallel([
        Animated.timing(buttonFadeAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(buttonSlideAnim, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // Continuous glow pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, {
          toValue: 0.4,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(glowPulse, {
          toValue: 0.15,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Ambient glow float
    Animated.loop(
      Animated.sequence([
        Animated.timing(topGlowAnim, {
          toValue: 10,
          duration: 4000,
          useNativeDriver: true,
        }),
        Animated.timing(topGlowAnim, {
          toValue: 0,
          duration: 4000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const handleGetStarted = async () => {
    await signInAsGuest();
    await updateSettings({ isOnboarded: true });
    router.replace('/(tabs)');
  };

  const handleGoToLogin = () => {
    router.push('/(auth)/login' as any);
  };

  return (
    <View style={styles.container}>
      {/* ── Ambient Neon Glows ── */}
      <Animated.View
        style={[
          styles.glowTop,
          {
            opacity: glowPulse,
            transform: [{ translateY: topGlowAnim }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.glowBottom,
          {
            opacity: glowPulse,
          },
        ]}
      />

      {/* ── Hero Image Section (top ~45%) ── */}
      <View style={styles.heroContainer}>
        <Image
          source={heroImage}
          style={styles.heroImage}
          resizeMode="cover"
        />
        {/* Gradient overlay to blend into background */}
        <LinearGradient
          colors={['transparent', `${Colors.background}66`, Colors.background]}
          style={styles.heroOverlay}
          locations={[0, 0.5, 1]}
        />
        {/* Bottom fade */}
        <LinearGradient
          colors={['transparent', Colors.background]}
          style={styles.heroBottomFade}
        />
      </View>

      {/* ── Content Section ── */}
      <View style={[styles.contentContainer, { paddingBottom: insets.bottom + 24 }]}>
        {/* Branding */}
        <Animated.View
          style={[
            styles.brandingContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <Text style={styles.title}>DOMPETO</Text>
          <Text style={styles.subtitle}>Asisten Finansial Pintar & Privat</Text>
        </Animated.View>

        {/* Action Area */}
        <Animated.View
          style={[
            styles.actionContainer,
            {
              opacity: buttonFadeAnim,
              transform: [{ translateY: buttonSlideAnim }],
            },
          ]}
        >
          {/* Primary CTA Button */}
          <Pressable
            onPress={handleGetStarted}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
          >
            {/* Glow border effect */}
            <LinearGradient
              colors={[Colors.primary, Colors.primaryDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.buttonGradientBorder}
            />
            {/* Inner glassmorphism surface */}
            <View style={styles.buttonInner}>
              <Text style={styles.buttonText}>Mulai Sekarang (Akses Instan)</Text>
              <Text style={styles.buttonIcon}>→</Text>
            </View>
          </Pressable>

          {/* Login Link */}
          <View style={styles.loginLinkRow}>
            <Text style={styles.loginLinkText}>Sudah punya akun? </Text>
            <Pressable onPress={handleGoToLogin} hitSlop={8}>
              <Text style={styles.loginLinkAction}>Masuk</Text>
            </Pressable>
          </View>

          {/* Privacy Tag */}
          <View style={styles.privacyTag}>
            <Text style={styles.privacyEmoji}>🔒</Text>
            <View style={styles.privacyTextContainer}>
              <Text style={styles.privacyText}>
                <Text style={styles.privacyBold}>100% Privat: </Text>
                Seluruh data keuangan disimpan aman secara offline di perangkat Anda tanpa pendaftaran akun.
              </Text>
            </View>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    position: 'relative',
    overflow: 'hidden',
  },

  // ── Ambient Glows ──
  glowTop: {
    position: 'absolute',
    top: -SCREEN_HEIGHT * 0.1,
    left: -SCREEN_WIDTH * 0.1,
    width: SCREEN_WIDTH * 0.7,
    height: SCREEN_HEIGHT * 0.35,
    borderRadius: 9999,
    backgroundColor: Colors.primary,
    opacity: 0.2,
    // Simulating blur with scale + opacity (RN doesn't support CSS blur on View)
    transform: [{ scale: 1.5 }],
  },
  glowBottom: {
    position: 'absolute',
    bottom: -SCREEN_HEIGHT * 0.1,
    right: -SCREEN_WIDTH * 0.1,
    width: SCREEN_WIDTH * 0.6,
    height: SCREEN_HEIGHT * 0.4,
    borderRadius: 9999,
    backgroundColor: Colors.secondary,
    opacity: 0.1,
    transform: [{ scale: 1.5 }],
  },

  // ── Hero Image ──
  heroContainer: {
    width: '100%',
    height: HERO_HEIGHT,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFill,
  },
  heroBottomFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
  },

  // ── Content ──
  contentContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    width: '100%',
    maxWidth: 448,
    alignSelf: 'center',
  },

  // ── Branding ──
  brandingContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontFamily: 'Outfit',
    fontSize: 36,
    fontWeight: '700',
    lineHeight: 44,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 8,
    // Text shadow glow
    textShadowColor: 'rgba(240, 240, 255, 0.2)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  subtitle: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
    color: Colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
  },

  // ── Primary Button ──
  primaryButton: {
    width: '100%',
    height: 56,
    borderRadius: 30,
    position: 'relative',
    overflow: 'hidden',
    // Outer shadow glow
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 8,
  },
  primaryButtonPressed: {
    transform: [{ scale: 0.97 }],
    shadowOpacity: 0.5,
    shadowRadius: 25,
  },
  buttonGradientBorder: {
    ...StyleSheet.absoluteFill,
    borderRadius: 30,
  },
  buttonInner: {
    ...StyleSheet.absoluteFill,
    margin: 1.5,
    borderRadius: 28.5,
    backgroundColor: 'rgba(28, 29, 57, 0.6)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: {
    fontFamily: 'Inter',
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.5,
    color: Colors.textPrimary,
  },
  buttonIcon: {
    fontSize: 18,
    color: Colors.textPrimary,
    fontWeight: '500',
  },

  // ── Action Container ──
  actionContainer: {
    gap: 16,
  },

  // ── Privacy Tag ──
  privacyTag: {
    marginTop: 8,
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(49, 50, 79, 0.3)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    // Glassmorphism feel
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  privacyEmoji: {
    fontSize: 16,
    lineHeight: 20,
    marginTop: 1,
  },
  privacyTextContainer: {
    flex: 1,
  },
  privacyText: {
    fontFamily: 'Inter',
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(199, 196, 216, 0.9)',
    textAlign: 'left',
  },
  privacyBold: {
    color: Colors.textPrimary,
    fontWeight: '500',
  },

  // ── Login Link ──
  loginLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  loginLinkText: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '400',
    color: Colors.textSecondary,
  },
  loginLinkAction: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '500',
    color: Colors.primary,
    textShadowColor: 'rgba(108, 99, 255, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
});
