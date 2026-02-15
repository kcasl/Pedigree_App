/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { API_BASE_URL } from './src/config/api';
import { PedigreeScreen } from './src/screens/PedigreeScreen';

const AUTH_STORAGE_KEY = 'auth.google.user.v1';
const AUTH_MODE_STORAGE_KEY = 'auth.mode.v1';
const GOOGLE_WEB_CLIENT_ID =
  '1086441770395-u066dpf25ppfjcktmtai6092p5e2pa6d.apps.googleusercontent.com';

type StoredAuthUser = {
  googleSub: string;
  name?: string | null;
  email: string;
  photo?: string | null;
  accessToken?: string;
};

type GoogleProfile = {
  id: string;
  email: string;
  name?: string | null;
  photo?: string | null;
};

function hasString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function toGoogleProfile(raw: unknown): GoogleProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!hasString(obj.id) || !hasString(obj.email)) return null;
  return {
    id: obj.id,
    email: obj.email,
    name: typeof obj.name === 'string' ? obj.name : null,
    photo: typeof obj.photo === 'string' ? obj.photo : null,
  };
}

export default function App() {
  const [isBooting, setIsBooting] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [user, setUser] = useState<StoredAuthUser | null>(null);
  const [isGuestMode, setIsGuestMode] = useState(false);

  const upsertUserOnServer = async (
    accessToken: string,
    payload: {
      idToken?: string | null;
      googleSub?: string;
      email?: string;
      name?: string | null;
      photo?: string | null;
    },
  ) => {
    const res = await fetch(`${API_BASE_URL}/v1/auth/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        id_token: payload.idToken ?? undefined,
        google_sub: payload.googleSub ?? undefined,
        email: payload.email ?? undefined,
        name: payload.name ?? undefined,
        photo_url: payload.photo ?? undefined,
      }),
    });
    if (!res.ok) {
      throw new Error(`auth_upsert_failed_${res.status}`);
    }
    return (await res.json()) as {
      google_sub: string;
      email: string;
      name?: string | null;
      photo_url?: string | null;
    };
  };

  const buildFallbackUser = (
    signedInUser: GoogleProfile,
    accessToken?: string,
  ): StoredAuthUser => ({
    googleSub: signedInUser.id,
    email: signedInUser.email,
    name: signedInUser.name,
    photo: signedInUser.photo,
    accessToken,
  });

  const resolveSignedInUser = (result: unknown): GoogleProfile | null => {
    const obj = (result ?? {}) as Record<string, unknown>;
    return (
      toGoogleProfile((obj.data as { user?: unknown } | undefined)?.user) ||
      toGoogleProfile(obj.user) ||
      toGoogleProfile(obj.data) ||
      toGoogleProfile(result)
    );
  };

  const migrateGuestPedigreeToGoogle = async (googleSub: string) => {
    const guestPeopleKey = 'pedigree.people.guest.v1';
    const guestQueueKey = 'pedigree.queue.guest.v1';
    const userPeopleKey = `pedigree.people.${googleSub}.v1`;
    const userQueueKey = `pedigree.queue.${googleSub}.v1`;
    try {
      const [guestPeople, guestQueue, userPeople, userQueue] = await Promise.all([
        AsyncStorage.getItem(guestPeopleKey),
        AsyncStorage.getItem(guestQueueKey),
        AsyncStorage.getItem(userPeopleKey),
        AsyncStorage.getItem(userQueueKey),
      ]);
      if (!userPeople && guestPeople) {
        await AsyncStorage.setItem(userPeopleKey, guestPeople);
      }
      if (!userQueue && guestQueue) {
        await AsyncStorage.setItem(userQueueKey, guestQueue);
      }
    } catch {
      // 마이그레이션 실패 시에도 로그인 진행
    }
  };

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      offlineAccess: false,
    });

    const restoreLogin = async () => {
      try {
        const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
        const mode = await AsyncStorage.getItem(AUTH_MODE_STORAGE_KEY);
        if (mode === 'guest') {
          setIsGuestMode(true);
        }
        if (raw) {
          const parsed = JSON.parse(raw) as StoredAuthUser;
          if (parsed?.email && parsed?.googleSub) {
            setUser(parsed);
            setIsGuestMode(false);
          }
        }

        // 앱 재실행 시 조용히 토큰 갱신 시도 (실패해도 기존 저장 유저로 사용)
        try {
          await GoogleSignin.hasPlayServices({
            showPlayServicesUpdateDialog: false,
          });
          const silent = await GoogleSignin.signInSilently();
          const silentUser = resolveSignedInUser(silent);
          if (silentUser?.email) {
            const tokens = await GoogleSignin.getTokens();
            let nextUser = buildFallbackUser(silentUser, tokens.accessToken);
            try {
              const serverUser = await upsertUserOnServer(tokens.accessToken, {
                idToken: tokens.idToken ?? undefined,
                googleSub: silentUser.id,
                email: silentUser.email,
                name: silentUser.name,
                photo: silentUser.photo,
              });
              nextUser = {
                googleSub: serverUser.google_sub,
                email: serverUser.email,
                name: serverUser.name,
                photo: serverUser.photo_url,
                accessToken: tokens.accessToken,
              };
            } catch {
              // 네트워크 불안정 시 서버 upsert를 건너뛰고 로컬 로그인 유지
            }
            setUser(nextUser);
            setIsGuestMode(false);
            await AsyncStorage.setItem(AUTH_MODE_STORAGE_KEY, 'google');
            await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextUser));
          }
        } catch {
          // silent sign-in 실패는 무시하고 저장된 로그인/게스트 모드로 진행
        }
      } catch {
        // 저장된 로그인 정보가 깨진 경우 로그인 화면으로 진행
      } finally {
        setIsBooting(false);
      }
    };

    restoreLogin();
  }, []);

  const onGoogleLogin = async () => {
    setIsSigningIn(true);
    try {
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
      const result = await GoogleSignin.signIn();
      const signedInUser = resolveSignedInUser(result);
      if (!signedInUser?.email) {
        Alert.alert('로그인 실패', '구글 계정 정보를 가져오지 못했어요.');
        return;
      }
      const tokens = await GoogleSignin.getTokens();
      let nextUser = buildFallbackUser(signedInUser, tokens.accessToken);
      try {
        const serverUser = await upsertUserOnServer(tokens.accessToken, {
          idToken: tokens.idToken ?? undefined,
          googleSub: signedInUser.id,
          email: signedInUser.email,
          name: signedInUser.name,
          photo: signedInUser.photo,
        });
        nextUser = {
          googleSub: serverUser.google_sub,
          name: serverUser.name,
          email: serverUser.email,
          photo: serverUser.photo_url,
          accessToken: tokens.accessToken,
        };
      } catch {
        Alert.alert('네트워크 안내', '서버 연결 없이 로그인했습니다. 연결되면 자동 동기화됩니다.');
      }
      await migrateGuestPedigreeToGoogle(nextUser.googleSub);
      setUser(nextUser);
      setIsGuestMode(false);
      await AsyncStorage.setItem(AUTH_MODE_STORAGE_KEY, 'google');
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextUser));
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      const message = (error as { message?: string })?.message ?? '';
      if (code === statusCodes.SIGN_IN_CANCELLED) return;
      if (code === statusCodes.IN_PROGRESS) return;
      if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('로그인 불가', 'Google Play 서비스가 필요합니다.');
        return;
      }
      const isDeveloperError =
        code === 'DEVELOPER_ERROR' ||
        code === '10' ||
        message.includes('DEVELOPER_ERROR') ||
        message.includes('10:');
      if (isDeveloperError) {
        Alert.alert(
          '로그인 설정 오류',
          'DEVELOPER_ERROR 입니다. Android 패키지명/SHA-1/OAuth 클라이언트 설정을 확인하세요.',
        );
        return;
      }
      Alert.alert('로그인 오류', `구글 로그인 중 오류가 발생했습니다. (${code ?? 'unknown'})`);
    } finally {
      setIsSigningIn(false);
    }
  };

  const onContinueWithoutLogin = async () => {
    setIsGuestMode(true);
    await AsyncStorage.setItem(AUTH_MODE_STORAGE_KEY, 'guest');
  };

  const onRequestLogout = async () => {
    try {
      await GoogleSignin.signOut();
    } catch {
      // 이미 로그아웃 상태일 수 있으므로 무시
    }
    setUser(null);
    setIsGuestMode(false);
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    await AsyncStorage.removeItem(AUTH_MODE_STORAGE_KEY);
  };

  const onRequestSwitchAccount = async () => {
    try {
      await GoogleSignin.signOut();
    } catch {
      // signOut 실패는 무시하고 로그인 시도
    }
    setUser(null);
    setIsGuestMode(false);
    await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    await AsyncStorage.removeItem(AUTH_MODE_STORAGE_KEY);
    await onGoogleLogin();
  };

  const onRequestLinkGoogle = async () => {
    await onGoogleLogin();
  };

  const isAuthenticated = !!user || isGuestMode;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
        {isBooting ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.loadingText}>앱 준비 중...</Text>
          </View>
        ) : isAuthenticated ? (
          <PedigreeScreen
            auth={
              user
                ? {
                    googleSub: user.googleSub,
                    accessToken: user.accessToken,
                    email: user.email,
                    name: user.name ?? undefined,
                  }
                : undefined
            }
            onRequestLogout={onRequestLogout}
            onRequestSwitchAccount={onRequestSwitchAccount}
            onRequestLinkGoogle={onRequestLinkGoogle}
          />
        ) : (
          <View style={styles.authWrap}>
            <Text style={styles.authTitle}>Pedigree App</Text>
            <Text style={styles.authSub}>가계도를 사용하려면 로그인해 주세요.</Text>

            <Pressable
              style={({ pressed }) => [
                styles.googleBtn,
                pressed && styles.pressed,
                isSigningIn && styles.disabledBtn,
              ]}
              disabled={isSigningIn}
              onPress={onGoogleLogin}
            >
              <Text style={styles.googleBtnText}>
                {isSigningIn ? '로그인 중...' : 'Google로 로그인'}
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.guestBtn, pressed && styles.pressed]}
              onPress={onContinueWithoutLogin}
            >
              <Text style={styles.guestBtnText}>로그인 없이 시작</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
  },
  loadingText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '700',
  },
  authWrap: {
    flex: 1,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  authTitle: {
    color: '#111827',
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 4,
  },
  authSub: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 18,
  },
  googleBtn: {
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
  },
  googleBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  guestBtn: {
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  guestBtnText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.9,
  },
  disabledBtn: {
    opacity: 0.7,
  },
});
