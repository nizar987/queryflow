import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { FILTERS, TRANSACTIONS } from '@/constants/dummyData';

const userAvatar = require('@/assets/images/dompeto-logo.png'); // Using logo as fallback for now


export default function TransactionsScreen() {
  const insets = useSafeAreaInsets();
  const [activeFilter, setActiveFilter] = useState('Semua');
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.avatarContainer}>
          <Image source={userAvatar} style={styles.avatarImage} />
        </View>
        <Text style={styles.headerTitle}>DOMPETO</Text>
        <Pressable style={styles.headerAction} hitSlop={8}>
          <MaterialIcons name="search" size={24} color={Colors.primary} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 }]}
      >
        {/* ── Title & Search ── */}
        <View style={styles.titleSection}>
          <Text style={styles.pageTitle}>Semua Transaksi</Text>
          <View style={styles.searchContainer}>
            <MaterialIcons
              name="search"
              size={20}
              color={Colors.textSecondary}
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Cari transaksi..."
              placeholderTextColor="rgba(199, 196, 216, 0.6)"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>

        {/* ── Filter Chips ── */}
        <View style={styles.filtersWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersScroll}
          >
            {FILTERS.map((filter) => {
              const isActive = activeFilter === filter;
              return (
                <Pressable
                  key={filter}
                  onPress={() => setActiveFilter(filter)}
                  style={[
                    styles.filterChip,
                    isActive ? styles.filterChipActive : styles.filterChipInactive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      isActive
                        ? styles.filterChipTextActive
                        : styles.filterChipTextInactive,
                    ]}
                  >
                    {filter}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Transactions List ── */}
        <View style={styles.listContainer}>
          {TRANSACTIONS.map((item) => {
            // Map our dynamic colors
            const baseColor = (Colors as any)[item.colorKey] || Colors.primary;
            const isIncome = item.type === 'income';

            return (
              <Pressable
                key={item.id}
                style={({ pressed }) => [
                  styles.transactionItem,
                  pressed && styles.transactionItemPressed,
                ]}
              >
                <View style={styles.transactionLeft}>
                  {/* Icon Circle */}
                  <View
                    style={[
                      styles.iconCircle,
                      {
                        backgroundColor: `${baseColor}20`, // 20% opacity approx
                        borderColor: `${baseColor}30`,
                        shadowColor: baseColor,
                      },
                    ]}
                  >
                    <MaterialIcons name={item.icon as any} size={24} color={baseColor} />
                  </View>

                  <View style={styles.transactionInfo}>
                    <Text style={styles.transactionTitle}>{item.title}</Text>
                    <Text style={styles.transactionSubtitle}>{item.subtitle}</Text>
                  </View>
                </View>

                {/* Amount */}
                <Text
                  style={[
                    styles.transactionAmount,
                    { color: isIncome ? Colors.secondary : Colors.danger },
                  ]}
                >
                  {item.amount}
                </Text>
              </Pressable>
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
    paddingBottom: 24,
    gap: 24,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: 'rgba(15, 16, 44, 0.3)', // bg-surface/30
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
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
    fontSize: 20,
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
    backgroundColor: 'transparent',
  },

  // ── Title & Search ──
  titleSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 16,
  },
  pageTitle: {
    fontFamily: 'Outfit',
    fontSize: 28,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  searchContainer: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: 16,
    zIndex: 1,
  },
  searchInput: {
    flex: 1,
    height: 48,
    backgroundColor: 'rgba(36, 36, 56, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(70, 69, 85, 0.3)',
    borderRadius: 12,
    paddingLeft: 44,
    paddingRight: 16,
    color: Colors.textPrimary,
    fontFamily: 'Inter',
    fontSize: 14,
  },

  // ── Filter Chips ──
  filtersWrapper: {
    // Full width scroll without padding cutting off
    marginHorizontal: -20,
    paddingHorizontal: 20,
  },
  filtersScroll: {
    paddingHorizontal: 20,
    gap: 12,
  },
  filterChip: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 9999,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterChipActive: {
    backgroundColor: 'rgba(108, 99, 255, 0.1)',
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  filterChipInactive: {
    backgroundColor: 'rgba(28, 29, 57, 0.5)',
    borderColor: 'rgba(70, 69, 85, 0.5)',
  },
  filterChipText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  filterChipTextActive: {
    color: Colors.primary,
  },
  filterChipTextInactive: {
    color: Colors.textSecondary,
  },

  // ── Transactions List ──
  listContainer: {
    paddingHorizontal: 20,
    gap: 12,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: 'rgba(28, 29, 57, 0.6)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  transactionItemPressed: {
    backgroundColor: Colors.surfaceSecondary,
  },
  transactionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flex: 1,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    // Soft glow shadow
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 2,
  },
  transactionInfo: {
    flex: 1,
    gap: 2,
  },
  transactionTitle: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  transactionSubtitle: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  transactionAmount: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: '500',
  },
});
