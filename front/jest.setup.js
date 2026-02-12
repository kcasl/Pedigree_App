import 'react-native-gesture-handler/jestSetup';

// Reanimated v3+ mock
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// Silence the warning: Animated: `useNativeDriver` is not supported...
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

