import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/** Lets code outside the component tree (the notification-tap handler)
 * trigger navigation — passed as NavigationContainer's ref in index.tsx. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
