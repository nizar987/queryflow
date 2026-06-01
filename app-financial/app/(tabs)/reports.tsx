import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/colors';
import { EXPENSE_CATEGORIES, MONTHLY_TRENDS, EXPENSE_DETAILS } from '@/constants/dummyData';

const userAvatar = require('@/assets/images/dompeto-logo.png');


export default function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const [timeFilter, setTimeFilter] = useState<'Bulanan' | 'Mingguan'>('Bulanan');

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerLeft}>
          <View style={styles.avatarContainer}>
            <Image source={userAvatar} style={styles.avatarImage} />
          </View>
          <Text style={styles.headerTitle}>Analisis Keuangan</Text>
        </View>
        <Pressable style={styles.headerAction} hitSlop={8}>
          <MaterialIcons name="notifications" size={24} color={Colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 }]}
      >
        {/* ── Time Toggle ── */}
        <View style={styles.toggleContainer}>
          <Pressable
            onPress={() => setTimeFilter('Bulanan')}
            style={[
              styles.toggleButton,
              timeFilter === 'Bulanan' && styles.toggleButtonActive,
            ]}
          >
            <Text
              style={[
                styles.toggleText,
                timeFilter === 'Bulanan' && styles.toggleTextActive,
              ]}
            >
              Bulanan
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTimeFilter('Mingguan')}
            style={[
              styles.toggleButton,
              timeFilter === 'Mingguan' && styles.toggleButtonActive,
            ]}
          >
            <Text
              style={[
                styles.toggleText,
                timeFilter === 'Mingguan' && styles.toggleTextActive,
              ]}
            >
              Mingguan
            </Text>
          </Pressable>
        </View>

        {/* ── Section 1: Kategori Pengeluaran ── */}
        <View style={styles.glassCard}>
          <Text style={styles.sectionTitle}>Kategori Pengeluaran</Text>
          
          <View style={styles.categoryContainer}>
            {/* Total Display */}
            <View style={styles.totalDisplay}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmount}>Rp 4.5M</Text>
            </View>

            {/* Horizontal Segmented Progress Bar (Alternative to Donut Chart for native without SVG) */}
            <View style={styles.segmentedBarContainer}>
              {EXPENSE_CATEGORIES.map((cat, index) => (
                <View
                  key={cat.id}
                  style={[
                    styles.segment,
                    { 
                      width: `${cat.percentage}%`, 
                      backgroundColor: cat.color,
                      borderTopLeftRadius: index === 0 ? 8 : 0,
                      borderBottomLeftRadius: index === 0 ? 8 : 0,
                      borderTopRightRadius: index === EXPENSE_CATEGORIES.length - 1 ? 8 : 0,
                      borderBottomRightRadius: index === EXPENSE_CATEGORIES.length - 1 ? 8 : 0,
                    }
                  ]}
                />
              ))}
            </View>

            {/* Legend */}
            <View style={styles.legendContainer}>
              {EXPENSE_CATEGORIES.map((cat) => (
                <View key={cat.id} style={styles.legendItem}>
                  <View style={styles.legendItemLeft}>
                    <View style={[styles.legendDot, { backgroundColor: cat.color, shadowColor: cat.color }]} />
                    <Text style={styles.legendLabel}>{cat.label}</Text>
                  </View>
                  <Text style={styles.legendPercentage}>{cat.percentage}%</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── Section 2: Tren Bulanan ── */}
        <View style={styles.glassCard}>
          <View style={styles.trendHeader}>
            <Text style={styles.sectionTitle}>Tren Bulanan</Text>
            <View style={styles.trendLegend}>
              <View style={styles.trendLegendItem}>
                <View style={[styles.trendDot, { backgroundColor: Colors.secondary }]} />
                <Text style={styles.trendLegendText}>Masuk</Text>
              </View>
              <View style={styles.trendLegendItem}>
                <View style={[styles.trendDot, { backgroundColor: Colors.danger }]} />
                <Text style={styles.trendLegendText}>Keluar</Text>
              </View>
            </View>
          </View>

          {/* Vertical Bar Chart */}
          <View style={styles.chartContainer}>
            {MONTHLY_TRENDS.map((item) => (
              <View key={item.month} style={styles.barGroup}>
                <View style={styles.barsWrapper}>
                  {/* Pemasukan Bar */}
                  <View style={styles.barColumn}>
                    <LinearGradient
                      colors={[Colors.secondary, `${Colors.secondary}33`]}
                      style={[styles.bar, { height: `${item.income}%` }]}
                    />
                  </View>
                  {/* Pengeluaran Bar */}
                  <View style={styles.barColumn}>
                    <LinearGradient
                      colors={[Colors.danger, `${Colors.danger}33`]}
                      style={[styles.bar, { height: `${item.expense}%` }]}
                    />
                  </View>
                </View>
                <Text style={styles.barLabel}>{item.month}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Section 3: Detail Pengeluaran ── */}
        <View style={styles.detailsSection}>
          <Text style={styles.sectionTitlePadding}>Detail Pengeluaran</Text>
          
          <View style={styles.detailsList}>
            {EXPENSE_DETAILS.map((item) => (
              <Pressable
                key={item.id}
                style={({ pressed }) => [
                  styles.detailCard,
                  pressed && styles.detailCardPressed,
                ]}
              >
                <View style={styles.detailLeft}>
                  <View style={styles.detailEmojiCircle}>
                    <Text style={styles.detailEmoji}>{item.emoji}</Text>
                  </View>
                  <View style={styles.detailInfo}>
                    <Text style={styles.detailTitle}>{item.title}</Text>
                    <Text style={styles.detailSubtitle}>{item.txCount} Transaksi</Text>
                  </View>
                </View>
                <View style={styles.detailRight}>
                  <Text style={styles.detailAmount}>{item.amount}</Text>
                  <Text style={[styles.detailPercentage, { color: item.colorText }]}>
                    {item.percentage}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
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
    gap: 24,
    paddingTop: 16,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: 'rgba(15, 16, 44, 0.3)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surfaceSecondary,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  headerTitle: {
    fontFamily: 'Outfit',
    fontSize: 24,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: -0.5,
  },
  headerAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(36, 36, 56, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },

  // ── Time Toggle ──
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(28, 29, 57, 0.6)',
    borderRadius: 9999,
    padding: 4,
    width: '100%',
    maxWidth: 300,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleButtonActive: {
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  toggleText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  toggleTextActive: {
    color: Colors.white,
    fontWeight: '600',
  },

  // ── Glass Card Base ──
  glassCard: {
    backgroundColor: 'rgba(28, 29, 57, 0.6)',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  sectionTitle: {
    fontFamily: 'Outfit',
    fontSize: 20,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 20,
  },

  // ── Section 1: Categories ──
  categoryContainer: {
    gap: 24,
  },
  totalDisplay: {
    alignItems: 'center',
    gap: 4,
  },
  totalLabel: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: Colors.textSecondary,
  },
  totalAmount: {
    fontFamily: 'Outfit',
    fontSize: 32,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  segmentedBarContainer: {
    flexDirection: 'row',
    height: 16,
    width: '100%',
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 8,
    overflow: 'hidden',
  },
  segment: {
    height: '100%',
  },
  legendContainer: {
    gap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  legendItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 2,
  },
  legendLabel: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: Colors.textSecondary,
  },
  legendPercentage: {
    fontFamily: 'Outfit',
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },

  // ── Section 2: Trends ──
  trendHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  trendLegend: {
    flexDirection: 'row',
    gap: 12,
  },
  trendLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  trendLegendText: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textSecondary,
  },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 150,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    paddingBottom: 24,
  },
  barGroup: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
    position: 'relative',
  },
  barsWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
    height: '100%',
    width: '100%',
  },
  barColumn: {
    flex: 1,
    maxWidth: 12,
    height: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: 10,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  barLabel: {
    position: 'absolute',
    bottom: -24,
    fontFamily: 'Inter',
    fontSize: 10,
    color: Colors.textSecondary,
  },

  // ── Section 3: Details ──
  detailsSection: {
    gap: 12,
  },
  sectionTitlePadding: {
    fontFamily: 'Outfit',
    fontSize: 20,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  detailsList: {
    gap: 12,
  },
  detailCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: 'rgba(28, 29, 57, 0.6)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  detailCardPressed: {
    backgroundColor: Colors.surfaceSecondary,
  },
  detailLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  detailEmojiCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: 'rgba(70, 69, 85, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailEmoji: {
    fontSize: 24,
  },
  detailInfo: {
    gap: 4,
  },
  detailTitle: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  detailSubtitle: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textSecondary,
  },
  detailRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  detailAmount: {
    fontFamily: 'Outfit',
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  detailPercentage: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '500',
  },
});
