import { useCallback, useEffect, useState } from "react";
import type { UpdateState } from "../../shared/updates.js";

/** Phases with something for the user to see or do. Idle/current/checking stay quiet. */
const CARD_PHASES: ReadonlyArray<UpdateState["phase"]> = [
  "available",
  "downloading",
  "ready",
  "installing",
  "error",
];

export interface UpdatesState {
  state: UpdateState | null;
  /** The update card has something to show (an update step or a handoff error). */
  cardVisible: boolean;
  /** The last manual check found nothing newer. */
  upToDate: boolean;
  run(action: () => Promise<UpdateState>): void;
  checkNow(): void;
}

export function useUpdates(): UpdatesState {
  const [state, setState] = useState<UpdateState | null>(null);
  const [checkedManually, setCheckedManually] = useState(false);
  useEffect(() => {
    let active = true;
    const api = window.vestraManager;
    const unsubscribe = api.onUpdate((value) => {
      if (active) setState(value);
    });
    void api
      .updateState()
      .then((value) => {
        if (active) setState(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const run = useCallback((action: () => Promise<UpdateState>): void => {
    void action()
      .then(setState)
      .catch((error) =>
        setState((previous) =>
          previous === null
            ? previous
            : { ...previous, phase: "error", message: String(error) },
        ),
      );
  }, []);
  const checkNow = useCallback((): void => {
    setCheckedManually(true);
    run(() => window.vestraManager.checkUpdate());
  }, [run]);
  const cardVisible =
    state !== null &&
    (CARD_PHASES.includes(state.phase) || Boolean(state.handoffError));
  return {
    state,
    cardVisible,
    upToDate: checkedManually && state?.phase === "current",
    run,
    checkNow,
  };
}

export function isCardPhase(phase: UpdateState["phase"]): boolean {
  return CARD_PHASES.includes(phase);
}
