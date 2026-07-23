import { ConflictException, NotFoundException } from '@nestjs/common';

export function planNotFound(id: string): NotFoundException {
  return new NotFoundException({
    businessStatus: 'PLAN_VERSION_NOT_FOUND',
    errorCode: 'PLAN_VERSION_NOT_FOUND',
    recoverableActions: ['REFRESH'],
    details: { planVersionId: id },
  });
}

export function planConflict(
  errorCode: string,
  businessStatus: string,
  recoverableActions: string[] = [],
): ConflictException {
  return new ConflictException({
    businessStatus,
    errorCode,
    recoverableActions,
  });
}
