import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      {/* ── Top App Bar ── */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.welcomeText}>Selamat datang 👋</Text>
          <Text style={styles.brandText}>DOMPETO</Text>
        </View>
        <LinearGradient
          colors={[Colors.primary, Colors.primaryDark]}
          style={styles.avatar}
        >
          <Text style={styles.avatarText}>JD</Text>
        </LinearGradient>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero Balance Card ── */}
        <LinearGradient
          colors={[Colors.primary, Colors.primaryDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          {/* Decorative Circle */}
          <View style={styles.heroDecoCircle} />

          <View style={styles.heroMain}>
            <Text style={styles.heroSubtitle}>Total Kekayaan</Text>
            <Text style={styles.heroBalance}>Rp 12.450.000</Text>
          </View>

          <View style={styles.heroFooter}>
            {/* Income Sub-panel */}
            <View style={styles.heroSubPanel}>
              <View style={styles.heroSubHeader}>
                <MaterialIcons name="arrow-upward" size={14} color={Colors.secondary} />
                <Text style={styles.heroSubLabel}>Pemasukan</Text>
              </View>
              <Text style={[styles.heroSubValue, { color: Colors.secondary }]}>
                Rp 15.000.000
              </Text>
            </View>

            {/* Expense Sub-panel */}
            <View style={styles.heroSubPanel}>
              <View style={styles.heroSubHeader}>
                <MaterialIcons name="arrow-downward" size={14} color={Colors.danger} />
                <Text style={styles.heroSubLabel}>Pengeluaran</Text>
              </View>
              <Text style={[styles.heroSubValue, { color: Colors.danger }]}>
                Rp 2.550.000
              </Text>
            </View>
          </View>
        </LinearGradient>

        {/* ── Quick Actions ── */}
        <View style={styles.quickActionsRow}>
          {/* Action 1: Pengeluaran */}
          <Pressable style={styles.actionItem}>
            <View style={[styles.actionIconContainer, styles.actionIconExpense]}>
              <MaterialIcons name="arrow-downward" size={24} color={Colors.danger} />
            </View>
            <Text style={styles.actionLabel}>Pengeluaran</Text>
          </Pressable>

          {/* Action 2: Pemasukan */}
          <Pressable style={styles.actionItem}>
            <View style={[styles.actionIconContainer, styles.actionIconIncome]}>
              <MaterialIcons name="arrow-upward" size={24} color={Colors.secondary} />
            </View>
            <Text style={styles.actionLabel}>Pemasukan</Text>
          </Pressable>

          {/* Action 3: Transfer */}
          <Pressable style={styles.actionItem}>
            <View style={[styles.actionIconContainer, styles.actionIconTransfer]}>
              <MaterialIcons name="sync-alt" size={24} color={Colors.primary} />
            </View>
            <Text style={styles.actionLabel}>Transfer</Text>
          </Pressable>
        </View>

        {/* ── Transactions Section ── */}
        <View style={styles.transactionsSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Transaksi Terbaru</Text>
            <Pressable hitSlop={8}>
              <Text style={styles.seeAllLink}>Lihat Semua</Text>
            </Pressable>
          </View>

          {/* Empty State */}
          <View style={styles.emptyStateCard}>
            <View style={styles.emptyStateIconWrapper}>
              <Text style={styles.emptyStateEmoji}>📭</Text>
            </View>
            <Text style={styles.emptyStateTitle}>Belum ada transaksi</Text>
            <Text style={styles.emptyStateSubtitle}>
              Tap + untuk mencatat transaksi pertamamu
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* ── Floating Action Button (FAB) ── */}
      <Pressable style={styles.fab}>
        <LinearGradient
          colors={[Colors.primary, Colors.primaryDark]}
          style={styles.fabGradient}
        >
          <MaterialIcons name="add" size={28} color={Colors.white} />
        </LinearGradient>
      </Pressable>
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
    gap: 24,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: Colors.background,
  },
  headerLeft: {
    flex: 1,
  },
  welcomeText: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  brandText: {
    fontFamily: 'Outfit',
    fontSize: 28,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: -0.5,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  avatarText: {
    fontFamily: 'Outfit',
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },

  // ── Hero Card ──
  heroCard: {
    borderRadius: 24,
    padding: 24,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  heroDecoCircle: {
    position: 'absolute',
    top: -48,
    right: -48,
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  heroMain: {
    gap: 8,
    marginBottom: 24,
  },
  heroSubtitle: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  heroBalance: {
    fontFamily: 'Outfit',
    fontSize: 32,
    fontWeight: '700',
    color: Colors.white,
    letterSpacing: -0.5,
  },
  heroFooter: {
    flexDirection: 'row',
    gap: 16,
  },
  heroSubPanel: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  heroSubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  heroSubLabel: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.9)',
  },
  heroSubValue: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: '600',
  },

  // ── Quick Actions ──
  quickActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  actionItem: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  actionIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28, 29, 57, 0.6)',
    borderWidth: 1,
    // Glassmorphism
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  actionIconExpense: {
    borderColor: 'rgba(255, 107, 107, 0.3)',
    shadowColor: Colors.danger,
  },
  actionIconIncome: {
    borderColor: 'rgba(0, 200, 150, 0.3)',
    shadowColor: Colors.secondary,
  },
  actionIconTransfer: {
    borderColor: 'rgba(108, 99, 255, 0.3)',
    shadowColor: Colors.primary,
  },
  actionLabel: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
  },

  // ── Transactions Section ──
  transactionsSection: {
    gap: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  sectionTitle: {
    fontFamily: 'Outfit',
    fontSize: 20,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  seeAllLink: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: Colors.primary,
  },
  emptyStateCard: {
    backgroundColor: 'rgba(28, 29, 57, 0.6)',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  emptyStateIconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyStateEmoji: {
    fontSize: 28,
  },
  emptyStateTitle: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  emptyStateSubtitle: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    maxWidth: 200,
  },

  // ── FAB ──
  fab: {
    position: 'absolute',
    bottom: 24, // Sits slightly above bottom navigation usually
    right: 20,
    width: 64,
    height: 64,
    borderRadius: 32,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  fabGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
