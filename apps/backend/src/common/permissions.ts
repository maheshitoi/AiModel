// Single source of truth for permission strings. "*" grants everything.
export const Permission = {
  All: '*',
  DashboardRead: 'dashboard:read',
  ConversationsRead: 'conversations:read',
  ConversationsReply: 'conversations:reply',
  ConversationsManage: 'conversations:manage',
  MessagesRead: 'messages:read',
  LogsRead: 'logs:read',
  AuditRead: 'audit:read',
  UsageRead: 'usage:read',
  ModelsRead: 'models:read',
  ModelsManage: 'models:manage',
  TrainingRead: 'training:read',
  TrainingManage: 'training:manage',
  DatasetsRead: 'datasets:read',
  DatasetsManage: 'datasets:manage',
  SettingsRead: 'settings:read',
  SettingsManage: 'settings:manage',
  UsersManage: 'users:manage',
} as const;

export type PermissionName = (typeof Permission)[keyof typeof Permission];

export const ROLE_PERMISSIONS: Record<string, { description: string; permissions: PermissionName[] }> = {
  ADMIN: { description: 'Full access, including users, credentials and model activation', permissions: [Permission.All] },
  OPERATOR: {
    description: 'Handles conversations and monitors the AI',
    permissions: [
      Permission.DashboardRead,
      Permission.ConversationsRead,
      Permission.ConversationsReply,
      Permission.ConversationsManage,
      Permission.MessagesRead,
      Permission.LogsRead,
      Permission.UsageRead,
      Permission.ModelsRead,
      Permission.TrainingRead,
      Permission.DatasetsRead,
      Permission.SettingsRead,
    ],
  },
  VIEWER: {
    description: 'Read-only access to dashboards and analytics',
    permissions: [
      Permission.DashboardRead,
      Permission.MessagesRead,
      Permission.UsageRead,
      Permission.ModelsRead,
      Permission.TrainingRead,
    ],
  },
};

export function hasPermissions(granted: string[], required: string[]): boolean {
  return granted.includes(Permission.All) || required.every((p) => granted.includes(p));
}
