import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { useSettingsStore } from '@/store/settingsStore';
import { Colors } from '@/constants/colors';

const logoImage = require('@/assets/images/dompeto-logo.png');

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signIn = useAuthStore((s) => s.signIn);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const updateSettings = useSettingsStore((s) => s.update);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const passwordRef = useRef<TextInput>(null);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(25)).current;
  const cardFadeAnim = useRef(new Animated.Value(0)).current;
  const cardSlideAnim = useRef(new Animated.Value(30)).current;
  const footerFadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Staggered entry
    Animated.sequence([
      Animated.delay(200),
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    Animated.sequence([
      Animated.delay(500),
      Animated.parallel([
        Animated.timing(cardFadeAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(cardSlideAnim, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    Animated.sequence([
      Animated.delay(900),
      Animated.timing(footerFadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Show error alert
  useEffect(() => {
    if (error) {
      Alert.alert('Login Gagal', error, [
        { text: 'OK', onPress: clearError },
      ]);
    }
  }, [error]);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Perhatian', 'Mohon isi email dan password.');
      return;
    }
    await signIn(email.trim(), password.trim());
    // Navigation is handled by _layout.tsx auth guard
    await updateSettings({ isOnboarded: true });
  };

  const handleGoToRegister = () => {
    router.push('/(auth)/register' as any);
  };

  return (
    <View style={styles.container}>
      {/* Ambient glow */}
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Brand Header ── */}
          <Animated.View
            style={[
              styles.brandContainer,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            {/* Logo */}
            <View style={styles.logoWrapper}>
              <Image source={logoImage} style={styles.logoImage} resizeMode="cover" />
              {/* Top-to-bottom gradient overlay on logo */}
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.2)']}
                style={styles.logoOverlay}
              />
            </View>

            <Text style={styles.brandTitle}>DOMPETO</Text>
            <Text style={styles.brandSubtitle}>Secure your wealth locally.</Text>
          </Animated.View>

          {/* ── Login Form Card ── */}
          <Animated.View
            style={[
              styles.formCard,
              {
                opacity: cardFadeAnim,
                transform: [{ translateY: cardSlideAnim }],
              },
            ]}
          >
            {/* Subtle background accent glow inside card */}
            <View style={styles.cardAccentGlow} />

            {/* Card Title */}
            <Text style={styles.cardTitle}>Masuk ke Akun</Text>

            {/* Email Input */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Email</Text>
              <View style={styles.inputContainer}>
                <MaterialIcons
                  name="mail-outline"
                  size={20}
                  color={Colors.textSecondary}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.textInput}
                  placeholder="Masukkan email"
                  placeholderTextColor="rgba(136,136,170,0.5)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={email}
                  onChangeText={setEmail}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              </View>
            </View>

            {/* Password Input */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Password</Text>
              <View style={styles.inputContainer}>
                <MaterialIcons
                  name="lock-outline"
                  size={20}
                  color={Colors.textSecondary}
                  style={styles.inputIcon}
                />
                <TextInput
                  ref={passwordRef}
                  style={[styles.textInput, { paddingRight: 48 }]}
                  placeholder="Masukkan password"
                  placeholderTextColor="rgba(136,136,170,0.5)"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <Pressable
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.visibilityButton}
                  hitSlop={8}
                >
                  <MaterialIcons
                    name={showPassword ? 'visibility' : 'visibility-off'}
                    size={20}
                    color={Colors.textSecondary}
                  />
                </Pressable>
              </View>
              <View style={styles.forgotRow}>
                <Pressable hitSlop={8}>
                  <Text style={styles.forgotText}>Lupa Password?</Text>
                </Pressable>
              </View>
            </View>

            {/* Login Button */}
            <Pressable
              onPress={handleLogin}
              disabled={isLoading}
              style={({ pressed }) => [
                styles.loginButton,
                pressed && !isLoading && styles.loginButtonPressed,
                isLoading && styles.loginButtonDisabled,
              ]}
            >
              <LinearGradient
                colors={[Colors.primary, Colors.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.loginButtonGradient}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <>
                    <Text style={styles.loginButtonText}>Masuk</Text>
                    <MaterialIcons name="arrow-forward" size={20} color={Colors.white} />
                  </>
                )}
              </LinearGradient>
            </Pressable>

            {/* Register Link */}
            <View style={styles.registerRow}>
              <Text style={styles.registerText}>Belum punya akun? </Text>
              <Pressable onPress={handleGoToRegister} hitSlop={8}>
                <Text style={styles.registerLink}>Daftar</Text>
              </Pressable>
            </View>
          </Animated.View>

          {/* ── Footer ── */}
          <Animated.View style={[styles.footer, { opacity: footerFadeAnim }]}>
            <MaterialIcons name="lock" size={14} color={Colors.textSecondary} />
            <Text style={styles.footerText}>
              100% Offline. Data Anda tersimpan aman secara lokal di perangkat ini.
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    top: -100,
    right: -60,
    width: 250,
    height: 250,
    borderRadius: 9999,
    backgroundColor: Colors.primary,
    opacity: 0.08,
    transform: [{ scale: 2 }],
  },
  glowBottom: {
    position: 'absolute',
    bottom: -80,
    left: -40,
    width: 200,
    height: 200,
    borderRadius: 9999,
    backgroundColor: Colors.secondary,
    opacity: 0.06,
    transform: [{ scale: 2 }],
  },

  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },

  // ── Brand Header ──
  brandContainer: {
    alignItems: 'center',
    gap: 16,
    marginBottom: 32,
  },
  logoWrapper: {
    width: 96,
    height: 96,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 12,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  logoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '40%',
  },
  brandTitle: {
    fontFamily: 'Outfit',
    fontSize: 36,
    fontWeight: '700',
    lineHeight: 44,
    color: Colors.textPrimary,
    letterSpacing: 2,
    textShadowColor: 'rgba(108, 99, 255, 0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  brandSubtitle: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 16,
  },

  // ── Form Card (Glassmorphism) ──
  formCard: {
    width: '100%',
    maxWidth: 448,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    gap: 24,
    position: 'relative',
    overflow: 'hidden',
    // Glassmorphism
    backgroundColor: 'rgba(26, 26, 46, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 16,
  },
  cardAccentGlow: {
    position: 'absolute',
    top: -96,
    right: -96,
    width: 192,
    height: 192,
    borderRadius: 9999,
    backgroundColor: 'rgba(108, 99, 255, 0.1)',
    transform: [{ scale: 1.5 }],
  },
  cardTitle: {
    fontFamily: 'Outfit',
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 28,
    color: Colors.textPrimary,
    marginBottom: 8,
  },

  // ── Input Fields ──
  fieldGroup: {
    width: '100%',
    gap: 8,
  },
  fieldLabel: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    letterSpacing: 0.5,
    color: 'rgba(240, 240, 255, 0.8)',
    marginLeft: 4,
  },
  inputContainer: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: 16,
    zIndex: 1,
    opacity: 0.7,
  },
  textInput: {
    flex: 1,
    height: 56,
    paddingLeft: 48,
    paddingRight: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(36, 36, 56, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    color: Colors.textPrimary,
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '400',
  },
  visibilityButton: {
    position: 'absolute',
    right: 16,
    zIndex: 1,
    padding: 4,
  },
  forgotRow: {
    alignItems: 'flex-end',
    marginTop: 4,
  },
  forgotText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.5,
    color: Colors.primary,
  },

  // ── Login Button ──
  loginButton: {
    width: '100%',
    height: 56,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
    // Neon glow
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  loginButtonPressed: {
    transform: [{ scale: 0.97 }],
    shadowOpacity: 0.6,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loginButtonText: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
    color: Colors.white,
  },

  // ── Register Row ──
  registerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  registerText: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '400',
    color: Colors.textSecondary,
  },
  registerLink: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '500',
    color: Colors.primary,
    textShadowColor: 'rgba(108, 99, 255, 0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },

  // ── Footer ──
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 32,
    paddingBottom: 16,
    opacity: 0.7,
  },
  footerText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.5,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
});
