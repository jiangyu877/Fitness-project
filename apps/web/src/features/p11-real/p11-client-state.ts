export type RecordClientState = {
  trustedSubjectId: string | null;
  taskId: string | null;
  recordTarget: RecordTarget | null;
  recordData: unknown;
  unsavedInput: unknown;
  conflictDraft: unknown;
  editor: { enabled: boolean } | null;
  pendingAuthoritativeRead?: { taskId: string };
  visibleRecoverableActions?: string[];
};

type RecordTarget =
  | { recordId: string }
  | {
    taskId: string;
    recordKindId: string;
    expectedRecordVersion: number | null;
  };

type RecordClientEvent = {
  businessStatus?: string;
  errorCode?: string;
  clientStateDisposition?: string;
  trustedSubjectId?: string | null;
  taskId?: string | null;
  recordTarget?: RecordTarget | null;
  nextAction?: string;
  recoverableActions?: string[];
};

const clearingErrorCodes = new Set([
  'SESSION_INVALID',
  'ROLE_NOT_AUTHORIZED',
  'RECORD_TASK_NOT_FOUND',
  'ROUTE_ACCESS_NOT_APPROVED',
  'RECORD_RESPONSE_INVALID',
]);

function clearedState(): RecordClientState {
  return {
    trustedSubjectId: null,
    taskId: null,
    recordTarget: null,
    recordData: null,
    unsavedInput: null,
    conflictDraft: null,
    editor: null,
  };
}

function isSameRecordTarget(current: RecordTarget | null, incoming: RecordTarget | null | undefined): boolean {
  if (!current || !incoming) return false;
  if ('recordId' in current || 'recordId' in incoming) {
    return 'recordId' in current
      && 'recordId' in incoming
      && current.recordId === incoming.recordId;
  }
  return current.taskId === incoming.taskId
    && current.recordKindId === incoming.recordKindId
    && current.expectedRecordVersion === incoming.expectedRecordVersion;
}

function hasExactRefresh(actions: string[] | undefined): boolean {
  return actions?.length === 1 && actions[0] === 'REFRESH';
}

export function applyRecordClientDisposition(
  state: RecordClientState,
  event: RecordClientEvent,
): RecordClientState {
  if (
    event.clientStateDisposition === 'CLEAR_ALL'
    && typeof event.errorCode === 'string'
    && clearingErrorCodes.has(event.errorCode)
  ) return clearedState();

  if (event.clientStateDisposition === 'PRESERVE_DRAFT_FOR_VERSION_CONFLICT') {
    const sameTrustedTarget = event.errorCode === 'RECORD_VERSION_CONFLICT'
      && typeof event.trustedSubjectId === 'string'
      && event.trustedSubjectId === state.trustedSubjectId
      && typeof event.taskId === 'string'
      && event.taskId === state.taskId
      && isSameRecordTarget(state.recordTarget, event.recordTarget)
      && hasExactRefresh(event.recoverableActions);
    if (!sameTrustedTarget) return clearedState();
    return {
      ...state,
      conflictDraft: state.unsavedInput,
      editor: { enabled: false },
      visibleRecoverableActions: ['REFRESH'],
    };
  }

  if (event.clientStateDisposition === 'DISABLE_EDITOR') {
    const sameTrustedContext = event.errorCode === 'RECORD_STATE_BLOCKED'
      && typeof event.trustedSubjectId === 'string'
      && event.trustedSubjectId === state.trustedSubjectId
      && typeof event.taskId === 'string'
      && event.taskId === state.taskId
      && Array.isArray(event.recoverableActions);
    if (!sameTrustedContext) return clearedState();
    return {
      ...state,
      editor: { enabled: false },
      visibleRecoverableActions: [...(event.recoverableActions ?? [])],
    };
  }

  if (
    event.businessStatus === 'RECORD_WRITE_ACCEPTED'
    && event.nextAction === 'GET_RECORD_CONTEXT'
    && Array.isArray(event.recoverableActions)
    && event.recoverableActions.length === 0
    && state.trustedSubjectId
    && state.taskId
  ) {
    return {
      ...state,
      editor: { enabled: false },
      pendingAuthoritativeRead: { taskId: state.taskId },
      visibleRecoverableActions: [],
    };
  }

  return clearedState();
}
