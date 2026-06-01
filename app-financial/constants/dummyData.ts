import { Colors } from './colors';

export const FILTERS = [
  'Semua',
  'Bulan Ini',
  'Pengeluaran',
  'Pemasukan',
  'Dompet Utama',
  'Kartu Kredit',
];

export const TRANSACTIONS = [
  {
    id: '1',
    title: 'Makan Siang',
    subtitle: 'Dompet Utama • Hari ini, 12:30',
    amount: '-Rp 45.000',
    type: 'expense',
    icon: 'restaurant',
    colorKey: 'warning',
  },
  {
    id: '2',
    title: 'Gaji Bulanan',
    subtitle: 'BCA Rekening • Kemarin, 09:00',
    amount: '+Rp 5.000.000',
    type: 'income',
    icon: 'payments',
    colorKey: 'secondary',
  },
  {
    id: '3',
    title: 'Transportasi',
    subtitle: 'OVO • Kemarin, 17:45',
    amount: '-Rp 25.000',
    type: 'expense',
    icon: 'directions-car',
    colorKey: 'primary',
  },
  {
    id: '4',
    title: 'Belanja Bulanan',
    subtitle: 'Kartu Kredit • 12 Nov, 14:20',
    amount: '-Rp 850.000',
    type: 'expense',
    icon: 'shopping-bag',
    colorKey: 'danger',
  },
  {
    id: '5',
    title: 'Kopi Sore',
    subtitle: 'GoPay • 11 Nov, 16:00',
    amount: '-Rp 35.000',
    type: 'expense',
    icon: 'local-cafe',
    colorKey: 'warning',
  },
];

export const EXPENSE_CATEGORIES = [
  { id: '1', label: 'Makanan', percentage: 45, color: '#6C63FF' },
  { id: '2', label: 'Transport', percentage: 25, color: '#00C896' },
  { id: '3', label: 'Belanja', percentage: 20, color: '#F59E0B' },
  { id: '4', label: 'Lainnya', percentage: 10, color: '#f16161' },
];

export const MONTHLY_TRENDS = [
  { month: 'Jan', income: 80, expense: 60 },
  { month: 'Feb', income: 90, expense: 70 },
  { month: 'Mar', income: 70, expense: 85 },
  { month: 'Apr', income: 95, expense: 50 },
  { month: 'Mei', income: 85, expense: 75 },
  { month: 'Jun', income: 100, expense: 65 },
];

export const EXPENSE_DETAILS = [
  {
    id: '1',
    emoji: '🍔',
    title: 'Makanan & Minuman',
    txCount: 15,
    amount: '-Rp 2.025.000',
    percentage: '45% dari total',
    colorText: Colors.primary,
  },
  {
    id: '2',
    emoji: '🚗',
    title: 'Transportasi',
    txCount: 8,
    amount: '-Rp 1.125.000',
    percentage: '25% dari total',
    colorText: Colors.secondary,
  },
  {
    id: '3',
    emoji: '🛍️',
    title: 'Belanja',
    txCount: 4,
    amount: '-Rp 900.000',
    percentage: '20% dari total',
    colorText: Colors.warning,
  },
];

export const SAVING_GOALS = [
  {
    id: '1',
    title: '💻 Macbook Pro',
    saved: 'Rp 15.000.000',
    target: 'Rp 25.000.000',
    percentage: 60,
    timeLeft: '12 hari tersisa',
    timeLeftIcon: 'schedule',
    timeLeftColorKey: 'warning',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD4CTAeNh3ldAVcjhMqdviyFMSHaBUTD7p3Bp2DNXjOQ3bi7fFrEFiHA6ClVCwUvKdaZRKsWeJ7E95tFNkECzTDgRKa6hvAZZ78wHh7pQShOFFurYQbAeTGcPV0EGFVPZMgd2sOuJv14rID1F4Gn8qdjcJPWwMkFBITVX1wRw1rzXugfXlSUAL7k6EO8BkoBa2x51dFRZnLEemq9Agpvrk3U8EJ8HWDDvFPGD1KXtQzfLre1IcOUxtHmI-rDln4I3sTG28VvugjllG1',
    progressColorKey: 'secondary',
  },
  {
    id: '2',
    title: '🗻 Liburan Jepang',
    saved: 'Rp 10.000.000',
    target: 'Rp 40.000.000',
    percentage: 25,
    timeLeft: '6 Bulan lagi',
    timeLeftIcon: 'event',
    timeLeftColorKey: 'textSecondary',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDnzf-neF0tvpFdsy63lp57hMnBmHTmDzRS3fSZAKiaUFRUFjXWePxSdKm2LD7lzFh3YCg4VcigkhRGCO9nEmlf3G-bbMorAgfV85YoaTs-g5RRNvCarr8M-3UUoitPZ7vSJaLNTnauslPQLpr83fP07awQR_2QO1dtN_9iK-fvrT6KFqIwNkKx9RKd9pIa3UgBzu-V2GIn4Xku7HB4R0WJK4J2KN1u8tysUNR4TSvElIcjrzJ1P08ZEi_3T2vgdNkUsr7cfMl-4BLD',
    progressColorKey: 'primary',
  },
];

