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

type Props = {
  label: string;
  person?: Person;
  onPress: () => void;
  style?: ViewStyle;
};

export function PersonNodeCard({ label, person, onPress, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
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
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarFallbackText}>
              {person?.name?.slice(0, 1) ?? '+'}
            </Text>
          </View>
        )}

        <Text style={styles.name} numberOfLines={1}>
          {person ? person.name : '추가'}
        </Text>
        {person?.phone ? (
          <Text style={styles.sub} numberOfLines={1}>
            {person.phone}
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
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 12,
    // width는 레이아웃 엔진에서 강제로 지정(세대/가로 배치에 따라 자동 조절)
  },
  pressed: {
    opacity: 0.85,
  },
  placeholder: {
    backgroundColor: '#ffffff',
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  badge: {
    fontSize: 12,
    color: '#374151',
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  content: {
    marginTop: 10,
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#f3f4f6',
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '700',
  },
  name: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
  },
  sub: {
    color: '#6b7280',
    fontSize: 12,
  },
});

