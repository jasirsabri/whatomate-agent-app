import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ChatScreen from '../screens/ChatScreen';
import AssignAgentScreen from '../screens/AssignAgentScreen';
import TransferDetailScreen from '../screens/TransferDetailScreen';
import MainTabs from './MainTabs';
import ChatHeaderTitle from './ChatHeaderTitle';
import { navigationRef } from './navigationRef';
import { getContact } from '../api/contacts';
import { logApiError } from '../api/logging';
import {
  addNotificationTapListener,
  checkLastNotificationResponse,
} from '../notifications';
import type { NotificationTapAction } from '../notifications';
import { colors } from '../theme';
import type { RootStackParamList } from './types';

export type { RootStackParamList, MainTabParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { isLoading, isAuthenticated } = useAuth();
  const checkedLaunchNotification = useRef(false);

  // Handles a tap on either notification kind — opens the specific chat
  // for an agent's message alert, or the Queue tab for a manager's
  // "new chat needs an agent" alert. Covers both the "app already
  // running" case (listener) and "app was fully killed, this tap
  // launched it" case (checked once at startup). Both destinations only
  // exist in the authenticated stack, so this no-ops while signed out.
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleTapAction = async (action: NotificationTapAction) => {
      try {
        if (!navigationRef.isReady()) return;
        if (action.type === 'chat') {
          const contact = await getContact(action.contactId);
          navigationRef.navigate('Chat', { contact });
        } else if (action.type === 'queue') {
          navigationRef.navigate('Main', { screen: 'QueueTab' });
        }
      } catch (err) {
        logApiError('Failed to handle notification tap:', err);
      }
    };

    // getLastNotificationResponseAsync() returns the same cached value for
    // the life of the process — without this guard, signing out and back
    // in within one session would re-navigate to the same old chat again.
    if (!checkedLaunchNotification.current) {
      checkedLaunchNotification.current = true;
      checkLastNotificationResponse().then((action) => {
        if (action) handleTapAction(action);
      });
    }

    return addNotificationTapListener(handleTapAction);
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.headerBackground },
          headerTitleStyle: { color: colors.textPrimary, fontSize: 17 },
          headerTintColor: colors.brandGreenDark,
          headerShadowVisible: true,
        }}
      >
        {isAuthenticated ? (
          <>
            <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen
              name="Chat"
              component={ChatScreen}
              options={({ route }) => ({
                headerTitle: () => <ChatHeaderTitle contact={route.params.contact} />,
              })}
            />
            <Stack.Screen
              name="AssignAgent"
              component={AssignAgentScreen}
              options={{ title: 'Assign to Agent' }}
            />
            <Stack.Screen
              name="TransferDetail"
              component={TransferDetailScreen}
              options={({ route }) => ({
                title: route.params.transfer.contact_name || route.params.transfer.phone_number,
              })}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ title: 'Settings' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
