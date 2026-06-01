import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ImageBackground,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/colors';
import { SAVING_GOALS } from '@/constants/dummyData';

export default function SavingsScreen() {
  const insets = useSafeAreaInsets();

  // Sum total accumulated or show the card's target total
  const totalAccumulated = 'Rp 25.000.000';

  return (
    <View style={styles.container}>
      {/* ── Sticky Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>Target Tabungan</Text>
          <Pressable
            style={({ pressed }) => [
              styles.addButton,
              pressed && styles.addButtonPressed,
            ]}
            hitSlop={8}
          >
            <MaterialIcons name="add" size={24} color={Colors.primary} />
          </Pressable>
        </View>

        {/* ── Total Saved Card ── */}
        <LinearGradient
          colors={[Colors.primary, Colors.primaryDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.totalCard}
        >
          {/* Decorative Blur blob */}
          <View style={styles.cardDecoCircle} />
          
          <Text style={styles.totalLabel}>Total Terkumpul</Text>
          <Text style={styles.totalAmount}>{totalAccumulated}</Text>
        </LinearGradient>
      </View>

      {/* ── Goals Scroll Container ── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 }]}
      >
        <View style={styles.goalsList}>
          {SAVING_GOALS.map((item) => {
            const baseColor = (Colors as any)[item.progressColorKey] || Colors.primary;
            const timeLeftColor = (Colors as any)[item.timeLeftColorKey] || Colors.textSecondary;

            return (
              <View key={item.id} style={styles.goalCard}>
                {/* Image Backdrop Section */}
                <ImageBackground
                  source={{ uri: item.image }}
                  style={styles.cardImage}
                  resizeMode="cover"
                >
                  {/* Gradient Overlay to blend into glass container */}
                  <LinearGradient
                    colors={['transparent', 'rgba(28, 29, 57, 0.65)']}
                    style={styles.imageOverlay}
                  />
                  <View style={styles.cardTitleContainer}>
                    <Text style={styles.goalTitle}>{item.title}</Text>
                  </View>
                </ImageBackground>

                {/* Details Section */}
                <View style={styles.cardDetails}>
                  <View style={styles.valuesRow}>
                    <View>
                      <Text style={styles.valueLabel}>Terkumpul</Text>
                      <Text style={styles.valueText}>{item.saved}</Text>
                    </View>
                    <View style={styles.alignRight}>
                      <Text style={styles.valueLabel}>Target</Text>
                      <Text style={styles.valueText}>{item.target}</Text>
                    </View>
                  </View>

                  {/* Progress Bar with soft neon glow */}
                  <View style={styles.progressBarTrack}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${item.percentage}%`,
                          backgroundColor: baseColor,
                          shadowColor: baseColor,
                        },
                      ]}
                    />
                  </View>

                  {/* Percentage & Time left status */}
                  <View style={styles.statusRow}>
                    <Text style={[styles.percentageText, { color: baseColor }]}>
                      {item.percentage}% Tercapai
                    </Text>
                    <View style={styles.timeLeftContainer}>
                      <MaterialIcons
                        name={item.timeLeftIcon as any}
                        size={14}
                        color={timeLeftColor}
                      />
                      <Text style={[styles.timeLeftText, { color: timeLeftColor }]}>
                        {item.timeLeft}
                      </Text>
                    </View>
                  </View>

                  {/* Tabung Sekarang Button with scale micro-animation */}
                  <Pressable
                    style={({ pressed }) => [
                      styles.saveButton,
                      pressed && styles.saveButtonPressed,
                    ]}
                  >
                    <MaterialIcons name="add-circle" size={18} color={Colors.primary} />
                    <Text style={styles.saveButtonText}>Tabung Sekarang</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },

  // ── Header Section ──
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: 'rgba(15, 16, 44, 0.3)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.03)',
    gap: 16,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: 'Outfit',
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  addButtonPressed: {
    transform: [{ scale: 0.95 }],
  },

  // ── Total Saved Card ──
  totalCard: {
    borderRadius: 20,
    padding: 24,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  cardDecoCircle: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(0, 200, 150, 0.25)', // glowing emerald overlay tint
  },
  totalLabel: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: 'rgba(240, 240, 255, 0.8)',
    marginBottom: 4,
  },
  totalAmount: {
    fontFamily: 'Outfit',
    fontSize: 32,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },

  // ── Goals List ──
  goalsList: {
    gap: 20,
  },
  goalCard: {
    backgroundColor: 'rgba(28, 29, 57, 0.65)', // glass panel bg
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: 128,
    justifyContent: 'flex-end',
  },
  imageOverlay: {
    ...StyleSheet.absoluteFill,
  },
  cardTitleContainer: {
    padding: 16,
    zIndex: 1,
  },
  goalTitle: {
    fontFamily: 'Outfit',
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
  },

  // ── Details ──
  cardDetails: {
    padding: 16,
    gap: 12,
  },
  valuesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  valueLabel: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  valueText: {
    fontFamily: 'Inter',
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  alignRight: {
    alignItems: 'flex-end',
  },

  // ── Progress Bar ──
  progressBarTrack: {
    height: 10,
    width: '100%',
    backgroundColor: Colors.surfaceTertiary, // track-bg
    borderRadius: 9999,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 9999,
    // Glow effect
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 2,
  },

  // ── Status ──
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  percentageText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '600',
  },
  timeLeftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeLeftText: {
    fontFamily: 'Inter',
    fontSize: 12,
  },

  // ── Save Button ──
  saveButton: {
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(36, 36, 56, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(108, 99, 255, 0.2)', // primary/20
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  saveButtonPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: 'rgba(108, 99, 255, 0.08)',
  },
  saveButtonText: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
});
