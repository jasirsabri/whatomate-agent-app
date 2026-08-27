import type { NavigatorScreenParams } from '@react-navigation/native';
import type { Contact } from '../types';
import type { AgentTransfer } from '../api/transfers';

export type MainTabParamList = {
  ChatsTab: undefined;
  QueueTab: undefined;
  ProfileTab: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Settings: undefined;
  // Typed to accept nested tab params (e.g. { screen: 'QueueTab' }) so a
  // manager notification tap can land directly on the Queue tab, not
  // just open the app to whichever tab it happened to be on before.
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  Chat: { contact: Contact };
  AssignAgent: { transfer: AgentTransfer };
  TransferDetail: { transfer: AgentTransfer };
};
