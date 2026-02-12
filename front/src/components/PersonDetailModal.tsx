import React from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Person } from '../types/pedigree';
import { formatKoreanDate } from '../utils/date';

type Props = {
  visible: boolean;
  person?: Person;
  onClose: () => void;
  onEdit: () => void;
  onDelete?: () => void;
};

export function PersonDetailModal({ visible, person, onClose, onEdit, onDelete }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>상세 정보</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>닫기</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.topRow}>
              {person?.photoUri ? (
                <Image source={{ uri: person.photoUri }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarFallbackText}>
                    {person?.name?.slice(0, 1) ?? '?'}
                  </Text>
                </View>
              )}
              <View style={styles.topText}>
                <Text style={styles.name}>{person?.name ?? ''}</Text>
                <Text style={styles.sub}>
                  등록일자: {formatKoreanDate(person?.createdAt)}
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>연락처</Text>
              <Text style={styles.value}>{person?.phone ?? '-'}</Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.label}>생년월일</Text>
              <Text style={styles.value}>{person?.birthDate ?? '-'}</Text>
            </View>
            <View style={styles.section}>
              <Text style={styles.label}>비고</Text>
              <Text style={styles.value}>{person?.note ?? '-'}</Text>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.primaryBtn} onPress={onEdit}>
              <Text style={styles.primaryText}>수정</Text>
            </Pressable>
            {onDelete ? (
              <Pressable style={styles.dangerBtn} onPress={onDelete}>
                <Text style={styles.dangerText}>삭제</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 18,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
    maxHeight: '86%',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
  },
  closeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  closeText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '800',
  },
  body: {
    padding: 16,
    gap: 12,
  },
  topRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginBottom: 6,
  },
  avatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#f3f4f6',
  },
  avatarFallback: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '900',
  },
  topText: {
    flex: 1,
    gap: 4,
  },
  name: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '900',
  },
  sub: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
  },
  section: {
    gap: 4,
  },
  label: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '900',
  },
  value: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    flexDirection: 'row',
    gap: 10,
  },
  primaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#2563eb',
    paddingVertical: 12,
  },
  primaryText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  dangerBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    paddingHorizontal: 14,
  },
  dangerText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '900',
  },
});

