export interface Principal {
  id: string;
  email: string;
  displayName?: string;
  status: "invited" | "active" | "deactivated";
  roles: string[];
  permissions: string[];
}
