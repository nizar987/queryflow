import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';

export default function SettingsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>⚙️ Setelan</Text>
      <Text style={styles.subtitle}>Coming soon...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '700' },
  subtitle: { color: Colors.textSecondary, marginTop: 8 },
});
