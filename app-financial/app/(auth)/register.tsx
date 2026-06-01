import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { useSettingsStore } from '@/store/settingsStore';
import { Colors } from '@/constants/colors';

export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signUp = useAuthStore((s) => s.signUp);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const updateSettings = useSettingsStore((s) => s.update);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);

  // Refs for keyboard navigation
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  // ── Animations ──
  const headerFadeAnim = useRef(new Animated.Value(0)).current;
  const headerSlideAnim = useRef(new Animated.Value(25)).current;
  const cardFadeAnim = useRef(new Animated.Value(0)).current;
  const cardSlideAnim = useRef(new Animated.Value(30)).current;
  const footerFadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(150),
      Animated.parallel([
        Animated.timing(headerFadeAnim, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(headerSlideAnim, {
          toValue: 0,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    Animated.sequence([
      Animated.delay(400),
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
      Animated.delay(850),
      Animated.timing(footerFadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Error feedback
  useEffect(() => {
    if (error) {
      Alert.alert('Registrasi Gagal', error, [
        { text: 'OK', onPress: clearError },
      ]);
    }
  }, [error]);

  const handleRegister = async () => {
    if (!name.trim()) {
      Alert.alert('Perhatian', 'Mohon isi nama lengkap.');
      return;
    }
    if (!email.trim()) {
      Alert.alert('Perhatian', 'Mohon isi email.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Perhatian', 'Password minimal 8 karakter.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Perhatian', 'Password dan konfirmasi password tidak cocok.');
      return;
    }

    await signUp(email.trim(), password);

    // Save security preferences
    await updateSettings({
      isOnboarded: true,
      biometricEnabled,
      pinEnabled,
    });
    // Navigation is handled by _layout.tsx auth guard on successful signUp
  };

  const handleGoToLogin = () => {
    router.back();
  };

  return (
    <View style={styles.container}>
      {/* ── Background Elements ── */}
      <LinearGradient
        colors={[`${Colors.primary}33`, Colors.background]}
        style={styles.bgGradient}
      />
      <View style={styles.glowSecondary} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Back Button ── */}
          <Animated.View
            style={[
              styles.backRow,
              {
                opacity: headerFadeAnim,
              },
            ]}
          >
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backButtonPressed,
              ]}
              hitSlop={8}
            >
              <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
            </Pressable>
          </Animated.View>

          {/* ── Title ── */}
          <Animated.View
            style={[
              styles.titleContainer,
              {
                opacity: headerFadeAnim,
                transform: [{ translateY: headerSlideAnim }],
              },
            ]}
          >
            <Text style={styles.pageTitle}>Daftar Akun</Text>
            <Text style={styles.pageSubtitle}>
              Bergabung dengan Dompeto, asisten finansial privat Anda.
            </Text>
          </Animated.View>

          {/* ── Form Card ── */}
          <Animated.View
            style={[
              styles.formCard,
              {
                opacity: cardFadeAnim,
                transform: [{ translateY: cardSlideAnim }],
              },
            ]}
          >
            {/* ─ Nama Lengkap ─ */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Nama Lengkap</Text>
              <View style={styles.inputContainer}>
                <MaterialIcons
                  name="person-outline"
                  size={20}
                  color={Colors.textSecondary}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.textInput}
                  placeholder="Masukkan nama lengkap"
                  placeholderTextColor="rgba(136,136,170,0.5)"
                  autoCapitalize="words"
                  autoCorrect={false}
                  value={name}
                  onChangeText={setName}
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                />
              </View>
            </View>

            {/* ─ Email ─ */}
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
                  ref={emailRef}
                  style={styles.textInput}
                  placeholder="contoh@email.com"
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

            {/* ─ Password ─ */}
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
                  placeholder="Min. 8 karakter"
                  placeholderTextColor="rgba(136,136,170,0.5)"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  returnKeyType="next"
                  onSubmitEditing={() => confirmPasswordRef.current?.focus()}
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
            </View>

            {/* ─ Konfirmasi Password ─ */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Konfirmasi Password</Text>
              <View style={styles.inputContainer}>
                <MaterialIcons
                  name="lock-reset"
                  size={20}
                  color={Colors.textSecondary}
                  style={styles.inputIcon}
                />
                <TextInput
                  ref={confirmPasswordRef}
                  style={[styles.textInput, { paddingRight: 48 }]}
                  placeholder="Ulangi password"
                  placeholderTextColor="rgba(136,136,170,0.5)"
                  secureTextEntry={!showConfirmPassword}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleRegister}
                />
                <Pressable
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={styles.visibilityButton}
                  hitSlop={8}
                >
                  <MaterialIcons
                    name={showConfirmPassword ? 'visibility' : 'visibility-off'}
                    size={20}
                    color={Colors.textSecondary}
                  />
                </Pressable>
              </View>
            </View>

            {/* ─ Separator ─ */}
            <View style={styles.separator} />

            {/* ─ Keamanan Opsional ─ */}
            <View style={styles.securitySection}>
              <Text style={styles.securitySectionTitle}>KEAMANAN OPSIONAL</Text>

              {/* Biometric Toggle */}
              <View style={styles.securityRow}>
                <View style={styles.securityRowLeft}>
                  <View style={styles.securityIconCircle}>
                    <MaterialIcons name="fingerprint" size={22} color={Colors.primary} />
                  </View>
                  <View style={styles.securityTextGroup}>
                    <Text style={styles.securityTitle}>Biometric Login</Text>
                    <Text style={styles.securitySubtitle}>Gunakan sidik jari / FaceID</Text>
                  </View>
                </View>
                <Switch
                  value={biometricEnabled}
                  onValueChange={setBiometricEnabled}
                  trackColor={{
                    false: Colors.surfaceTertiary,
                    true: Colors.primary,
                  }}
                  thumbColor={Colors.white}
                  ios_backgroundColor={Colors.surfaceTertiary}
                />
              </View>

              {/* PIN Toggle */}
              <View style={styles.securityRow}>
                <View style={styles.securityRowLeft}>
                  <View style={styles.securityIconCircle}>
                    <MaterialIcons name="dialpad" size={22} color={Colors.primary} />
                  </View>
                  <View style={styles.securityTextGroup}>
                    <Text style={styles.securityTitle}>PIN Keamanan</Text>
                    <Text style={styles.securitySubtitle}>Tambahkan 6 digit PIN</Text>
                  </View>
                </View>
                <Switch
                  value={pinEnabled}
                  onValueChange={setPinEnabled}
                  trackColor={{
                    false: Colors.surfaceTertiary,
                    true: Colors.primary,
                  }}
                  thumbColor={Colors.white}
                  ios_backgroundColor={Colors.surfaceTertiary}
                />
              </View>
            </View>

            {/* ─ Submit Button ─ */}
            <Pressable
              onPress={handleRegister}
              disabled={isLoading}
              style={({ pressed }) => [
                styles.submitButton,
                pressed && !isLoading && styles.submitButtonPressed,
                isLoading && styles.submitButtonDisabled,
              ]}
            >
              <LinearGradient
                colors={[Colors.primary, Colors.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.submitButtonGradient}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <>
                    <Text style={styles.submitButtonText}>Daftar Sekarang</Text>
                    <MaterialIcons name="arrow-forward" size={20} color={Colors.white} />
                  </>
                )}
              </LinearGradient>
            </Pressable>
          </Animated.View>

          {/* ── Footer ── */}
          <Animated.View style={[styles.footerContainer, { opacity: footerFadeAnim }]}>
            {/* Privacy Badge */}
            <View style={styles.privacyBadge}>
              <MaterialIcons name="lock" size={14} color={Colors.secondary} />
              <Text style={styles.privacyBadgeText}>100% Privat: Data aman secara offline</Text>
            </View>

            {/* Login link */}
            <View style={styles.loginRow}>
              <Text style={styles.loginRowText}>Sudah punya akun? </Text>
              <Pressable onPress={handleGoToLogin} hitSlop={8}>
                <Text style={styles.loginRowLink}>Masuk</Text>
              </Pressable>
            </View>
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

  // ── Background Elements ──
  bgGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '50%',
    opacity: 0.2,
    borderBottomLeftRadius: 9999,
    borderBottomRightRadius: 9999,
  },
  glowSecondary: {
    position: 'absolute',
    top: '-20%',
    right: '-10%',
    width: 384,
    height: 384,
    borderRadius: 9999,
    backgroundColor: Colors.secondary,
    opacity: 0.06,
    transform: [{ scale: 1.5 }],
  },

  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    maxWidth: 448,
    width: '100%',
    alignSelf: 'center',
  },

  // ── Back Button ──
  backRow: {
    paddingTop: 8,
    paddingBottom: 24,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(70, 69, 85, 1)',
  },
  backButtonPressed: {
    backgroundColor: Colors.surfaceTertiary,
  },

  // ── Title ──
  titleContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  pageTitle: {
    fontFamily: 'Outfit',
    fontSize: 36,
    fontWeight: '700',
    lineHeight: 44,
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  pageSubtitle: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
    color: Colors.textSecondary,
    textAlign: 'center',
  },

  // ── Form Card (Glassmorphism) ──
  formCard: {
    width: '100%',
    borderRadius: 16,
    padding: 24,
    gap: 16,
    // Glassmorphism
    backgroundColor: 'rgba(26, 26, 46, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(145, 143, 161, 0.2)',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 14,
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
    color: Colors.textSecondary,
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
    backgroundColor: Colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: 'rgba(70, 69, 85, 1)',
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

  // ── Separator ──
  separator: {
    height: 1,
    backgroundColor: 'rgba(70, 69, 85, 0.5)',
    marginVertical: 8,
  },

  // ── Security Section ──
  securitySection: {
    width: '100%',
    gap: 12,
  },
  securitySectionTitle: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    letterSpacing: 1,
    color: Colors.textSecondary,
  },
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceSecondary,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(70, 69, 85, 1)',
  },
  securityRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  securityIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  securityTextGroup: {
    flex: 1,
  },
  securityTitle: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  securitySubtitle: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.5,
    color: Colors.textSecondary,
    lineHeight: 16,
  },

  // ── Submit Button ──
  submitButton: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    marginTop: 8,
    // Neon glow
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  submitButtonPressed: {
    transform: [{ scale: 0.97 }],
    shadowOpacity: 0.6,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitButtonText: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
    color: Colors.white,
  },

  // ── Footer ──
  footerContainer: {
    alignItems: 'center',
    gap: 16,
    marginTop: 32,
    paddingBottom: 16,
  },
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(36, 36, 56, 0.5)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(0, 200, 150, 0.2)',
  },
  privacyBadgeText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.5,
    color: Colors.secondary,
    lineHeight: 16,
  },
  loginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  loginRowText: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '400',
    color: Colors.textSecondary,
  },
  loginRowLink: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '500',
    color: Colors.primary,
    textShadowColor: 'rgba(108, 99, 255, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
});
