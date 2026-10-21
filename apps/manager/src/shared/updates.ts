export interface UpdateState {
  phase:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "installing"
    | "current"
    | "error";
  currentVersion: string;
  version?: string;
  progress?: number;
  message?: string;
  checkedAt?: number;
  supported: boolean;
}
