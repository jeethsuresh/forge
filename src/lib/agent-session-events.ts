export type OperatorStopReason = "end" | "stop" | "cancel" | "recovery_abort";

export const OPERATOR_STOP_PREFIX = "operator_stop:";

export function operatorStopError(reason: OperatorStopReason): string {
  return `${OPERATOR_STOP_PREFIX}${reason}`;
}

export function isOperatorStopError(message: string | null | undefined): boolean {
  return (message ?? "").startsWith(OPERATOR_STOP_PREFIX);
}
