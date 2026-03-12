export type DepartmentKey =
  | 'executive'
  | 'hr'
  | 'cfa'
  | 'finance'
  | 'marketing'
  | 'product'
  | 'inventory'
  | 'employee';

export type Scope = 'own' | 'all' | 'assigned_location';

export type Action =
  | 'view'
  | 'create'
  | 'edit'
  | 'approve'
  | 'finalize'
  | 'manage'
  | 'export'
  | 'import'
  | 'join'
  | 'submit'
  | 'upload'
  | 'override'
  | 'write'
  | 'publish'
  | 'lock'
  | 'convert'
  | 'order';

export type PermissionKey = `${string}:${Action}` | `${string}:${Action}:${Scope}`;

export interface ResourceDefinition {
  department: DepartmentKey;
  resource: string;
  actions: Action[];
  label: string;
  description?: string;
}

export interface PermissionDefinition {
  permissionKey: PermissionKey;
  department: DepartmentKey;
  resource: string;
  action: Action;
  scope: Scope | null;
  label: string;
  description?: string;
  legacyAliases?: string[];
}

export interface RoleDefinition {
  roleKey: string;
  roleName: string;
  description: string;
  isSystem: boolean;
  permissions: PermissionKey[];
}

export interface NavItemDefinition {
  id: string;
  label: string;
  href: string;
  permission: PermissionKey;
}

export interface NavSectionDefinition {
  id: string;
  label: string;
  children: NavItemDefinition[];
}

export interface VisibleNavSection {
  id: string;
  label: string;
  children: NavItemDefinition[];
}
