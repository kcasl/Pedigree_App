import React from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import type { Person } from '../types/pedigree';
import { ui } from '../theme/ui';

type Props = {
  label: string;
  person?: Person;
  onPress: () => void;
  style?: ViewStyle;
  highlighted?: boolean;
  generation?: number;
};

type FallbackAvatarTheme = {
  bg: string;
  fg: string;
  border: string;
};

function formatPhoneForNode(phone?: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function fallbackAvatarTheme(gender?: Person['gender']): FallbackAvatarTheme {
  if (gender === 'male') {
    return {
      bg: '#EDF5FF',
      fg: '#7FA8D8',
      border: '#D3E4FA',
    };
  }
  if (gender === 'female') {
    return {
      bg: '#F6EEFF',
      fg: '#A47CCF',
      border: '#E2D2F6',
    };
  }
  return {
    bg: '#EFF4FA',
    fg: '#8B9AAF',
    border: '#D7E1ED',
  };
}

export function PersonNodeCard({ label, person, onPress, style, highlighted, generation = 0 }: Props) {
  const rowBg = ui.generationSurface(generation);
  const avatarTheme = fallbackAvatarTheme(person?.gender);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: rowBg },
        highlighted && styles.highlighted,
        pressed && styles.pressed,
        !person && styles.placeholder,
        style,
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.badge}>{label}</Text>
      </View>

      <View style={styles.content}>
        {person?.photoUri ? (
          <Image source={{ uri: person.photoUri }} style={styles.avatar} />
        ) : person ? (
          <View
            style={[
              styles.avatarFallback,
              { backgroundColor: avatarTheme.bg, borderColor: avatarTheme.border },
            ]}
          >
            <View style={[styles.personHead, { backgroundColor: avatarTheme.fg }]} />
            <View style={[styles.personBody, { backgroundColor: avatarTheme.fg }]} />
          </View>
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarFallbackText}>+</Text>
          </View>
        )}

        <Text style={styles.name} numberOfLines={1}>
          {person ? person.name : '추가'}
        </Text>
        {person?.phone ? (
          <Text style={styles.sub} numberOfLines={1}>
            {formatPhoneForNode(person.phone)}
          </Text>
        ) : (
          <Text style={styles.sub} numberOfLines={1}>
            {person ? ' ' : '탭해서 등록'}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    backgroundColor: ui.color.surface,
    borderWidth: 1.5,
    borderColor: ui.color.border,
    padding: 12,
    ...ui.shadow.card,
  },
  pressed: {
    opacity: 0.88,
  },
  highlighted: {
    borderWidth: 3,
    borderColor: '#2e7d32',
    backgroundColor: '#f1f8e9',
  },
  placeholder: {
    opacity: 0.92,
    borderStyle: 'dashed',
    borderColor: ui.color.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  badge: {
    fontSize: 12,
    color: ui.color.label,
    backgroundColor: ui.color.badgeBg,
    borderWidth: 1,
    borderColor: ui.color.borderLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    fontWeight: ui.weight.label,
  },
  content: {
    marginTop: 10,
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: ui.color.badgeBg,
    borderWidth: 1,
    borderColor: ui.color.borderLight,
  },
  avatarFallback: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: ui.color.badgeBg,
    borderWidth: 1,
    borderColor: ui.color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personHead: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginBottom: 5,
  },
  personBody: {
    width: 34,
    height: 30,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
  },
  avatarFallbackText: {
    color: ui.color.text,
    fontSize: 24,
    fontWeight: ui.weight.title,
  },
  name: {
    color: ui.color.text,
    fontSize: 16,
    fontWeight: ui.weight.heading,
  },
  sub: {
    color: ui.color.textSecondary,
    fontSize: 12,
    fontWeight: ui.weight.body,
  },
});
