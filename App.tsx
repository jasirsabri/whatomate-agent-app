import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { loadServerUrl } from './src/config';
import { initializeNotifications } from './src/notifications';
import { AuthProvider } from './src/context/AuthContext';
import { SocketProvider } from './src/context/SocketContext';
import RootNavigator from './src/navigation';

export default function App() {
  // Must finish before anything below mounts — AuthContext's own startup
  // effect (restoring tokens) and any screen it renders could otherwise
  // fire a request against the wrong (default) server URL for the brief
  // moment before this finishes loading the saved one.
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    Promise.all([loadServerUrl(), initializeNotifications()]).finally(() =>
      setConfigLoaded(true)
    );
  }, []);

  if (!configLoaded) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SocketProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </SocketProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
