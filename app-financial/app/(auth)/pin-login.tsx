import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
  Animated,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { useSettingsStore } from '@/store/settingsStore';
import { Colors } from '@/constants/colors';

const logoImage = require('@/assets/images/dompeto-logo.png');

export default function PinLoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState('');
  
  // Actually verify against stored PIN in a real app. 
  // Here we assume any 6 digit PIN works for demo, or verify against settingsStore.pin
  const updateSettings = useSettingsStore((s) => s.update);
  const verifyPin = useAuthStore((s) => s.verifyPin); // We need to add this action

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(25)).current;
  const cardFadeAnim = useRef(new Animated.Value(0)).current;
  const cardSlideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(100),
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 600,
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
  }, []);

  const handleKeyPress = (key: string) => {
    if (pin.length < 6) {
      setPin((prev) => prev + key);
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  const handleBiometric = () => {
    // Implement biometric auth here if needed
    // For now, simulate success
    handleSuccess();
  };

  const handleSuccess = async () => {
    await verifyPin(); // sets isPinVerified = true in authStore
    await updateSettings({ lastActive: Date.now() });
    router.replace('/(tabs)' as any);
  };

  useEffect(() => {
    if (pin.length === 6) {
      // Check PIN logic here
      // For demonstration, any 6 digit is accepted
      handleSuccess();
    }
  }, [pin]);

  const renderPinIndicators = () => {
    const indicators = [];
    for (let i = 0; i < 6; i++) {
      const isFilled = i < pin.length;
      indicators.push(
        <View
          key={i}
          style={[
            styles.pinIndicator,
            isFilled ? styles.pinIndicatorFilled : styles.pinIndicatorEmpty,
          ]}
        />
      );
    }
    return indicators;
  };

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.content,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 },
        ]}
      >
        {/* Brand Header */}
        <Animated.View
          style={[
            styles.brandContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={styles.logoWrapper}>
            <Image source={logoImage} style={styles.logoImage} resizeMode="cover" />
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.2)']}
              style={styles.logoOverlay}
            />
          </View>
          <Text style={styles.brandTitle}>DOMPETO</Text>
          <Text style={styles.brandSubtitle}>Secure your wealth locally.</Text>
        </Animated.View>

        {/* PIN Entry Card */}
        <Animated.View
          style={[
            styles.formCard,
            {
              opacity: cardFadeAnim,
              transform: [{ translateY: cardSlideAnim }],
            },
          ]}
        >
          <View style={styles.cardAccentGlow} />

          <Text style={styles.cardTitle}>Masukkan PIN</Text>

          {/* PIN Indicators */}
          <View style={styles.pinIndicatorsContainer}>{renderPinIndicators()}</View>

          {/* Keypad */}
          <View style={styles.keypad}>
            {/* Row 1 */}
            <Pressable style={styles.keyButton} onPress={() => handleKeyPress('1')}>
              <Text style={styles.keyText}>1</Text>
            </Pressable>
            <Pressable style={styles.keyButton} onPress={() => handleKeyPress('2')}>
              <Text style={styles.keyText}>2</Text>
            </Pressable>
            <Pressable style={styles.keyButton} onPress={() => handleKeyPress('3')}>
              <Text style={styles.keyText}>3</Text>
            </Pressable>

            {/* Row 2 */}
            <Pressable style={styles.keyButton} onPress={() => handleKeyPress('4')}>
              <Text style={styles.keyText}>4</Text>
            </Pressable>
            <Pressable style={styles.keyButton} onPress={() => handleKeyPress('5')}>
              <Text style={styles.keyText}>5</Text>
            </Pressable>
            <Pressable style={styles.keyButton} onPress={() => handleKeyPress('6')}>
              <Text style={styles.keyText}>6</Text>
            </Pressable>

            {/* Row 3 */}
            <Pressable style={styles.keyButton} onPress={() => handleKeyPress('7')}>
              <Text style={styles.keyText}>7</Text>
            </Pressable>
            <Pressable style={styles.keyButton} onPress={() => handleKeyPress('8')}>
              <Text style={styles.keyText}>8</Text>
            </Pressable>
            <Pressable style={styles.keyButton} onPress={() => handleKeyPress('9')}>
              <Text style={styles.keyText}>9</Text>
            </Pressable>

            {/* Row 4 */}
            <Pressable style={styles.actionButton} onPress={handleBiometric}>
              <MaterialIcons name="fingerprint" size={28} color={Colors.textSecondary} />
            </Pressable>
            <Pressable style={styles.keyButton} onPress={() => handleKeyPress('0')}>
              <Text style={styles.keyText}>0</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={handleBackspace}>
              <MaterialIcons name="backspace" size={28} color={Colors.textSecondary} />
            </Pressable>
          </View>
        </Animated.View>

        {/* Footer Info */}
        <Animated.View style={[styles.footer, { opacity: cardFadeAnim }]}>
          <MaterialIcons name="lock" size={14} color={Colors.textSecondary} />
          <Text style={styles.footerText}>
            Data Anda tersimpan aman secara lokal di perangkat ini.
          </Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    width: '100%',
    maxWidth: 448,
    alignSelf: 'center',
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

  // ── Form Card ──
  formCard: {
    width: '100%',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    gap: 24,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: 'rgba(26, 26, 46, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
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

  // ── PIN Indicators ──
  pinIndicatorsContainer: {
    flexDirection: 'row',
    gap: 16,
    marginVertical: 8,
  },
  pinIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  pinIndicatorFilled: {
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 5,
  },
  pinIndicatorEmpty: {
    backgroundColor: Colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },

  // ── Keypad ──
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 280,
    gap: 16,
  },
  keyButton: {
    width: '28%',
    aspectRatio: 1,
    borderRadius: 9999,
    backgroundColor: 'rgba(36, 36, 56, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  keyText: {
    fontFamily: 'Outfit',
    fontSize: 32,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  actionButton: {
    width: '28%',
    aspectRatio: 1,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Footer ──
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 32,
    opacity: 0.7,
  },
  footerText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
});
