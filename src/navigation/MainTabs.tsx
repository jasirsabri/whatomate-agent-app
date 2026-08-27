import React, { useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import ConversationListScreen from '../screens/ConversationListScreen';
import QueueScreen from '../screens/QueueScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { useCanManageQueue } from '../hooks/useCanManageQueue';
import { requestNotificationPermission, getExpoPushToken } from '../notifications';
import { registerPushToken } from '../api/pushBridge';
import { colors } from '../theme';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabs() {
  const canManageQueue = useCanManageQueue();

  // Requested here rather than only inside the Profile toggle's onChange —
  // the toggle defaults to "on" in the app's own preference, so it never
  // actually gets touched (and never triggers a permission request) on a
  // fresh install. This runs once per authenticated session (MainTabs only
  // mounts when signed in), which is early enough to matter and avoids
  // asking before the person has any reason to trust the app yet.
  //
  // Once permission is confirmed, also fetch and register this device's
  // push token with the bridge service — this is what actually makes
  // background push notifications possible; permission alone doesn't.
  useEffect(() => {
    (async () => {
      const granted = await requestNotificationPermission();
      if (!granted) return;
      const token = await getExpoPushToken();
      if (token) {
        await registerPushToken(token);
      }
    })();
  }, []);

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.headerBackground },
        headerTitleStyle: { color: colors.textPrimary },
        headerTintColor: colors.brandGreenDark,
        headerShadowVisible: true,
        tabBarActiveTintColor: colors.brandGreenDark,
        tabBarInactiveTintColor: colors.iconGray,
        tabBarStyle: { backgroundColor: colors.headerBackground },
      }}
    >
      <Tab.Screen
        name="ChatsTab"
        component={ConversationListScreen}
        options={{
          headerShown: false, // ConversationListScreen renders its own header
          title: 'Chats',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'chatbubbles' : 'chatbubbles-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      {canManageQueue && (
        <Tab.Screen
          name="QueueTab"
          component={QueueScreen}
          options={{
            title: 'Queue',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'people' : 'people-outline'} size={size} color={color} />
            ),
          }}
        />
      )}
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'person-circle' : 'person-circle-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
