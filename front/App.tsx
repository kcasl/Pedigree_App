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
  type User,
} from '@react-native-google-signin/google-signin';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { API_BASE_URL } from './src/config/api';
import { PedigreeScreen } from './src/screens/PedigreeScreen';

const AUTH_STORAGE_KEY = 'auth.google.user.v1';
const GOOGLE_WEB_CLIENT_ID =
  '1086441770395-u066dpf25ppfjcktmtai6092p5e2pa6d.apps.googleusercontent.com';

type StoredAuthUser = {
  googleSub: string;
  name?: string | null;
  email: string;
  photo?: string | null;
  accessToken?: string;
};

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
    signedInUser: User,
    accessToken?: string,
  ): StoredAuthUser => ({
    googleSub: signedInUser.id,
    email: signedInUser.email,
    name: signedInUser.name,
    photo: signedInUser.photo,
    accessToken,
  });

  const resolveSignedInUser = (result: unknown): User | null => {
    const fromData = (result as { data?: { user?: User } })?.data?.user;
    if (fromData?.email) return fromData;
    const fromLegacy = (result as { user?: User })?.user;
    if (fromLegacy?.email) return fromLegacy;
    return null;
  };

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      offlineAccess: false,
    });

    const restoreLogin = async () => {
      try {
        const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as StoredAuthUser;
          if (parsed?.email && parsed?.googleSub) {
            setUser(parsed);
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
      setUser(nextUser);
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextUser));
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === statusCodes.SIGN_IN_CANCELLED) return;
      if (code === statusCodes.IN_PROGRESS) return;
      if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('로그인 불가', 'Google Play 서비스가 필요합니다.');
        return;
      }
      Alert.alert('로그인 오류', '구글 로그인 중 오류가 발생했습니다.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const onContinueWithoutLogin = () => {
    setIsGuestMode(true);
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
                  }
                : undefined
            }
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
