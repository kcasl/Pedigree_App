import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  launchCamera,
  launchImageLibrary,
  type CameraOptions,
  type ImageLibraryOptions,
} from 'react-native-image-picker';
import type { GenderType, Person } from '../types/pedigree';
import { nowIso } from '../utils/date';
import { createId } from '../utils/id';
import { ensureCameraPermission, ensurePhotoPermission } from '../utils/permissions';
import { API_BASE_URL } from '../config/api';

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (person: Person) => void;
  auth?: { googleSub: string; accessToken?: string };
  /**
   * 수정 모드일 때 기존 값을 주입합니다.
   * - id/createdAt는 유지
   */
  initialPerson?: Person;
};

const imagePickerCommon: ImageLibraryOptions = {
  mediaType: 'photo',
  selectionLimit: 1,
  includeBase64: false,
  // 최신 타입 정의에서는 0~1 float 대신 enum/리터럴만 허용하는 경우가 있어 기본값(생략) 사용
};

const cameraOptions: CameraOptions = {
  ...imagePickerCommon,
  saveToPhotos: false,
  cameraType: 'back',
};

export function AddPersonModal({
  visible,
  title,
  onClose,
  onSubmit,
  initialPerson,
  auth,
}: Props) {
  const [name, setName] = useState(initialPerson?.name ?? '');
  const [phone, setPhone] = useState(initialPerson?.phone ?? '');
  const [birthDate, setBirthDate] = useState(initialPerson?.birthDate ?? '');
  const [photoUri, setPhotoUri] = useState<string | undefined>(
    initialPerson?.photoUri,
  );
  const [note, setNote] = useState(initialPerson?.note ?? '');
  const [gender, setGender] = useState<GenderType>(initialPerson?.gender ?? 'unknown');

  // 모달을 "추가/수정"으로 번갈아 쓸 때 초기값이 바뀌면 폼도 동기화
  useEffect(() => {
    if (!visible) return;
    setName(initialPerson?.name ?? '');
    setPhone(initialPerson?.phone ?? '');
    setBirthDate(initialPerson?.birthDate ?? '');
    setPhotoUri(initialPerson?.photoUri);
    setNote(initialPerson?.note ?? '');
    setGender(initialPerson?.gender ?? 'unknown');
  }, [visible, initialPerson?.id]);

  const canSave = useMemo(() => name.trim().length > 0, [name]);

  const reset = () => {
    setName(initialPerson?.name ?? '');
    setPhone(initialPerson?.phone ?? '');
    setBirthDate(initialPerson?.birthDate ?? '');
    setPhotoUri(initialPerson?.photoUri);
    setNote(initialPerson?.note ?? '');
    setGender(initialPerson?.gender ?? 'unknown');
  };

  const pickFromGallery = async () => {
    const ok = await ensurePhotoPermission();
    if (!ok) return;
    const res = await launchImageLibrary(imagePickerCommon);
    if (res.didCancel) return;
    if (res.errorCode) {
      Alert.alert('사진 선택 실패', res.errorMessage ?? res.errorCode);
      return;
    }
    const uri = res.assets?.[0]?.uri;
    if (uri) {
      if (auth?.googleSub && auth.accessToken) {
        const uploaded = await uploadPhotoToServer(uri, auth.googleSub, auth.accessToken);
        setPhotoUri(uploaded ?? uri);
      } else {
        setPhotoUri(uri);
      }
    }
  };

  const takePhoto = async () => {
    const ok = await ensureCameraPermission();
    if (!ok) return;
    const res = await launchCamera(cameraOptions);
    if (res.didCancel) return;
    if (res.errorCode) {
      Alert.alert('카메라 실행 실패', res.errorMessage ?? res.errorCode);
      return;
    }
    const uri = res.assets?.[0]?.uri;
    if (uri) {
      if (auth?.googleSub && auth.accessToken) {
        const uploaded = await uploadPhotoToServer(uri, auth.googleSub, auth.accessToken);
        setPhotoUri(uploaded ?? uri);
      } else {
        setPhotoUri(uri);
      }
    }
  };

  const uploadPhotoToServer = async (
    uri: string,
    googleSub: string,
    accessToken: string,
  ): Promise<string | null> => {
    try {
      const form = new FormData();
      form.append('google_sub', googleSub);
      form.append('file', {
        uri,
        name: `photo_${Date.now()}.jpg`,
        type: 'image/jpeg',
      } as unknown as Blob);

      const res = await fetch(`${API_BASE_URL}/v1/uploads/photo`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { url?: string };
      return data.url ?? null;
    } catch {
      return null;
    }
  };

  const submit = () => {
    if (!canSave) {
      Alert.alert('필수 입력', '이름은 필수입니다.');
      return;
    }

    const person: Person = initialPerson
      ? {
          ...initialPerson,
          name: name.trim(),
          phone: phone.trim() || undefined,
          birthDate: birthDate.trim() || undefined,
          photoUri,
          note: note.trim() || undefined,
          gender,
        }
      : {
          id: createId('person'),
          name: name.trim(),
          phone: phone.trim() || undefined,
          birthDate: birthDate.trim() || undefined,
          createdAt: nowIso(),
          photoUri,
          note: note.trim() || undefined,
          gender,
        };

    onSubmit(person);
    reset();
  };

  const close = () => {
    reset();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={close} style={styles.closeBtn}>
              <Text style={styles.closeText}>닫기</Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.field}>
              <Text style={styles.label}>이름 *</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="예: 홍길동"
                placeholderTextColor="#64748b"
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>성별</Text>
              <View style={styles.genderRow}>
                <Pressable
                  onPress={() => setGender('male')}
                  style={[
                    styles.genderBtn,
                    gender === 'male' && styles.genderBtnActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.genderBtnText,
                      gender === 'male' && styles.genderBtnTextActive,
                    ]}
                  >
                    남성
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setGender('female')}
                  style={[
                    styles.genderBtn,
                    gender === 'female' && styles.genderBtnActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.genderBtnText,
                      gender === 'female' && styles.genderBtnTextActive,
                    ]}
                  >
                    여성
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setGender('unknown')}
                  style={[
                    styles.genderBtn,
                    gender === 'unknown' && styles.genderBtnActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.genderBtnText,
                      gender === 'unknown' && styles.genderBtnTextActive,
                    ]}
                  >
                    미정
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>연락처</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="예: 010-1234-5678"
                placeholderTextColor="#64748b"
                keyboardType="phone-pad"
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>생년월일</Text>
              <TextInput
                value={birthDate}
                onChangeText={setBirthDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#64748b"
                style={styles.input}
              />
            </View>

            <View style={styles.field}>
              <View style={styles.noteHeader}>
                <Text style={styles.label}>비고(기타 정보)</Text>
                <Text style={styles.noteCount}>{note.length}/100</Text>
              </View>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="추가로 기록할 내용을 적어주세요 (최대 100자)"
                placeholderTextColor="#64748b"
                maxLength={100}
                multiline
                style={[styles.input, styles.noteInput]}
              />
            </View>

            <View style={styles.photoRow}>
              <Pressable onPress={takePhoto} style={styles.photoBtn}>
                <Text style={styles.photoBtnText}>카메라</Text>
              </Pressable>
              <Pressable onPress={pickFromGallery} style={styles.photoBtn}>
                <Text style={styles.photoBtnText}>갤러리</Text>
              </Pressable>
              <Pressable
                onPress={() => setPhotoUri(undefined)}
                style={[styles.photoBtn, styles.photoBtnDanger]}
              >
                <Text style={[styles.photoBtnText, styles.photoBtnDangerText]}>제거</Text>
              </Pressable>
              <View style={styles.photoInfo}>
                <Text style={styles.photoInfoText} numberOfLines={1}>
                  {photoUri ? '사진 선택됨' : '사진 없음'}
                </Text>
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={submit}
              disabled={!canSave}
              style={({ pressed }) => [
                styles.saveBtn,
                !canSave && styles.saveBtnDisabled,
                pressed && canSave && styles.saveBtnPressed,
              ]}
            >
              <Text style={styles.saveText}>저장</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
    maxHeight: '88%',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
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
    fontWeight: '700',
  },
  body: {
    padding: 16,
    gap: 14,
  },
  field: {
    gap: 6,
  },
  label: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '700',
  },
  input: {
    color: '#111827',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  noteCount: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '800',
  },
  noteInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  genderRow: {
    flexDirection: 'row',
    gap: 8,
  },
  genderBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    paddingVertical: 10,
  },
  genderBtnActive: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  genderBtnText: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '800',
  },
  genderBtnTextActive: {
    color: '#1d4ed8',
  },
  photoRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  photoBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  photoBtnText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '800',
  },
  photoBtnDanger: {
    borderColor: '#fecaca',
    backgroundColor: '#fff1f2',
  },
  photoBtnDangerText: {
    color: '#b91c1c',
  },
  photoInfo: {
    flex: 1,
    paddingHorizontal: 10,
  },
  photoInfoText: {
    color: '#6b7280',
    fontSize: 12,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  saveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#2563eb',
    paddingVertical: 12,
  },
  saveBtnPressed: {
    opacity: 0.9,
  },
  saveBtnDisabled: {
    backgroundColor: '#93c5fd',
    opacity: 0.6,
  },
  saveText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
});

