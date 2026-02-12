import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';

async function requestAndroidPermission(
  permission: string,
  rationaleTitle: string,
  rationaleMessage: string,
): Promise<boolean> {
  try {
    const already = await PermissionsAndroid.check(permission as any);
    if (already) return true;

    const res = await PermissionsAndroid.request(permission as any, {
      title: rationaleTitle,
      message: rationaleMessage,
      buttonPositive: '허용',
      buttonNegative: '거부',
    });

    if (res === PermissionsAndroid.RESULTS.GRANTED) return true;

    const neverAskAgain = res === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;
    if (neverAskAgain) {
      Alert.alert(
        '권한 필요',
        '설정에서 권한을 허용해야 기능을 사용할 수 있어요.',
        [
          { text: '취소', style: 'cancel' },
          { text: '설정 열기', onPress: () => Linking.openSettings() },
        ],
      );
    }
    return false;
  } catch {
    return false;
  }
}

export async function ensureCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  return requestAndroidPermission(
    PermissionsAndroid.PERMISSIONS.CAMERA,
    '카메라 권한',
    '사진 촬영을 위해 카메라 권한이 필요합니다.',
  );
}

export async function ensurePhotoPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const version = typeof Platform.Version === 'number' ? Platform.Version : 0;
  if (version >= 33) {
    // Android 13+
    return requestAndroidPermission(
      'android.permission.READ_MEDIA_IMAGES',
      '사진 접근 권한',
      '사진 선택을 위해 저장소(사진) 접근 권한이 필요합니다.',
    );
  }

  // Android 12 이하
  return requestAndroidPermission(
    PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
    '저장소 권한',
    '사진 선택을 위해 저장소 접근 권한이 필요합니다.',
  );
}

