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
  /** A failed update handoff, kept until the user dismisses it. */
  handoffError?: string;
}
