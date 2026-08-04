import type { P11RecordPortSchema } from './p11-record-repository.port.js';

export type P11RecordContextScalar = string | number | boolean;

export type P11RecordContextInput = Readonly<{
  sessionTokenHash: string;
  taskId: string;
  requestId: string;
  nodeEnv: 'test';
}>;

export type P11RecordContextEntry = Readonly<{
  fieldId: string;
  value: P11RecordContextScalar;
}>;

export type P11RecordContextRecord = Readonly<{
  recordId: string;
  recordKindId: string;
  recordVersion: number;
  schemaVersion: string;
  entries: readonly P11RecordContextEntry[];
}>;

export type P11RecordContextResult = Readonly<{
  taskId: string;
  planVersion: string;
  businessDate: string;
  accessMode: 'EDITABLE' | 'READ_ONLY';
  records: readonly P11RecordContextRecord[];
}>;

export interface P11RecordContextPort {
  getContext(
    input: P11RecordContextInput,
    schema: P11RecordPortSchema,
  ): Promise<P11RecordContextResult>;
}
