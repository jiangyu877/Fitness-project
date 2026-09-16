// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../../app/app.js';
import type { IdentityClient } from '../identity/identity-client.js';
import { P11ClientError, type P11Client } from './p11-client.js';
import { P11RecordPage } from './p11-record-page.js';

const session = { accountId: 'trusted-user', token: 'trusted-token' };
const context = {
  businessStatus: 'RECORD_CONTEXT_AVAILABLE' as const,
  taskId: 'task-opaque',
  planVersion: 'plan-opaque',
  businessDate: 'server-date',
  accessMode: 'EDITABLE' as const,
  schema: {
    version: 'schema-test-v1',
    testOnly: true,
    recordKinds: [{ id: 'kind-opaque', fields: [], allowedActions: ['UPSERT_RECORD' as const] }],
  },
  records: [],
};

afterEach(cleanup);

describe('P11 GET_RECORD_CONTEXT page consumer', () => {
  it('loads a parsed context for the trusted session without rendering a write control or demo fallback', async () => {
    const getContext = vi.fn().mockResolvedValue(context);
    const client = { getContext } as unknown as P11Client;

    render(<MemoryRouter><P11RecordPage taskId="task-opaque" session={session} client={client} /></MemoryRouter>);

    expect(await screen.findByTestId('p11-record-context')).toBeInTheDocument();
    expect(getContext).toHaveBeenCalledWith(session, 'task-opaque');
    expect(screen.getByTestId('p11-context-task')).toHaveTextContent('task-opaque');
    expect(screen.getByTestId('p11-context-schema')).toHaveTextContent('schema-test-v1');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('仅用于原型演示，未经专业审核')).not.toBeInTheDocument();
  });

  it('clears the consumer on a malformed response instead of falling back to demo content', async () => {
    const client = {
      getContext: vi.fn().mockRejectedValue(new P11ClientError(
        'invalid', 502, 'RECORD_RESPONSE_INVALID', [], 'request-1', 'CLEAR_ALL',
      )),
    } as unknown as P11Client;

    render(<MemoryRouter><P11RecordPage taskId="task-opaque" session={session} client={client} /></MemoryRouter>);

    expect(await screen.findByTestId('p11-record-context-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('p11-context-error-code')).toHaveTextContent('RECORD_RESPONSE_INVALID');
    expect(screen.getByTestId('p11-context-disposition')).toHaveTextContent('CLEAR_ALL');
    expect(screen.queryByText('仅用于原型演示，未经专业审核')).not.toBeInTheDocument();
  });

  it('keeps the task locator route separate from the catalog demo page', async () => {
    const identityClient: IdentityClient = {
      hasStoredSession: () => true,
      restoreSession: async () => ({
        kind: 'session-created', accountId: session.accountId, token: session.token,
        expiresAt: '2026-08-03T18:00:00.000Z', nextAction: 'VIEW_TODAY',
      }),
      createSession: async () => { throw new Error('unused'); },
      changeInitialPassword: async () => { throw new Error('unused'); },
      logout: async () => undefined,
      getRestrictedContext: () => null,
    };
    const getContext = vi.fn().mockResolvedValue(context);

    render(
      <MemoryRouter initialEntries={['/h5/records?taskId=task-opaque']}>
        <AppRoutes identityClient={identityClient} p11Client={{ getContext } as unknown as P11Client} />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('p11-record-context')).toBeInTheDocument();
    expect(getContext).toHaveBeenCalledWith(session, 'task-opaque');
  });

  it('does not fall back to the catalog when the task locator is malformed', async () => {
    const identityClient: IdentityClient = {
      hasStoredSession: () => true,
      restoreSession: async () => ({
        kind: 'session-created', accountId: session.accountId, token: session.token,
        expiresAt: '2026-08-03T18:00:00.000Z', nextAction: 'VIEW_TODAY',
      }),
      createSession: async () => { throw new Error('unused'); },
      changeInitialPassword: async () => { throw new Error('unused'); },
      logout: async () => undefined,
      getRestrictedContext: () => null,
    };
    const getContext = vi.fn();

    render(
      <MemoryRouter initialEntries={['/h5/records?taskId=']}>
        <AppRoutes identityClient={identityClient} p11Client={{ getContext } as unknown as P11Client} />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('p11-record-context-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('p11-context-error-code')).toHaveTextContent('P11_TASK_ID_REQUIRED');
    expect(getContext).not.toHaveBeenCalled();
    expect(screen.queryByText('仅用于原型演示，未经专业审核')).not.toBeInTheDocument();
  });

  it.each(['production', 'development'] as const)('does not activate the test-only consumer in %s mode', async (mode) => {
    const identityClient: IdentityClient = {
      hasStoredSession: () => true,
      restoreSession: async () => ({
        kind: 'session-created', accountId: session.accountId, token: session.token,
        expiresAt: '2026-08-03T18:00:00.000Z', nextAction: 'VIEW_TODAY',
      }),
      createSession: async () => { throw new Error('unused'); },
      changeInitialPassword: async () => { throw new Error('unused'); },
      logout: async () => undefined,
      getRestrictedContext: () => null,
    };
    const getContext = vi.fn().mockResolvedValue(context);

    render(
      <MemoryRouter initialEntries={['/h5/records?taskId=task-opaque']}>
        <AppRoutes
          demoEnvironment={{ mode, dev: mode === 'development', demoPersonaSwitcher: 'true' }}
          identityClient={identityClient}
          p11Client={{ getContext } as unknown as P11Client}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('p11-record-context-test-only')).toBeInTheDocument();
    expect(getContext).not.toHaveBeenCalled();
    expect(screen.queryByTestId('p11-record-context')).not.toBeInTheDocument();
    expect(screen.queryByText('仅用于原型演示，未经专业审核')).not.toBeInTheDocument();
  });

  it('submits schema-driven primitive input and waits for an authoritative reread', async () => {
    const editableContext = {
      ...context,
      schema: {
        ...context.schema,
        recordKinds: [{
          id: 'kind-opaque',
          fields: [{ id: 'field-1', valueType: 'STRING' as const, required: true }],
          allowedActions: ['UPSERT_RECORD' as const],
        }],
      },
    };
    const refreshedContext = {
      ...editableContext,
      records: [{
        recordId: 'record-opaque', recordKindId: 'kind-opaque', recordVersion: 1,
        schemaVersion: 'schema-test-v1', entries: [{ fieldId: 'field-1', value: 'opaque-entry' }],
      }],
    };
    const getContext = vi.fn()
      .mockResolvedValueOnce(editableContext)
      .mockResolvedValueOnce(refreshedContext);
    const upsertRecord = vi.fn().mockResolvedValue({
      businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1,
      schemaVersion: 'schema-test-v1', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
    });
    const client = { getContext, upsertRecord } as unknown as P11Client;

    render(<MemoryRouter><P11RecordPage taskId="task-opaque" session={session} client={client} /></MemoryRouter>);

    const input = await screen.findByLabelText('field-1');
    fireEvent.change(input, { target: { value: 'opaque-entry' } });
    fireEvent.click(screen.getByRole('button', { name: '提交测试记录' }));

    await waitFor(() => expect(upsertRecord).toHaveBeenCalledWith(session, 'task-opaque', {
      operation: 'UPSERT_RECORD', recordKindId: 'kind-opaque', schemaVersion: 'schema-test-v1',
      expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: 'opaque-entry' }],
    }));
    await waitFor(() => expect(getContext).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('p11-record-write-status')).toHaveTextContent('RECORD_CONTEXT_REFRESHED');
    expect(screen.getByTestId('p11-context-record-count')).toHaveTextContent('1');
  });

  it('allows an optional string field to submit an empty primitive value', async () => {
    const optionalContext = {
      ...context,
      schema: {
        ...context.schema,
        recordKinds: [{
          id: 'kind-opaque',
          fields: [{ id: 'field-1', valueType: 'STRING' as const }],
          allowedActions: ['UPSERT_RECORD' as const],
        }],
      },
    };
    const getContext = vi.fn().mockResolvedValue(optionalContext);
    const upsertRecord = vi.fn().mockResolvedValue({
      businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1,
      schemaVersion: 'schema-test-v1', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
    });
    const client = { getContext, upsertRecord } as unknown as P11Client;

    render(<MemoryRouter><P11RecordPage taskId="task-opaque" session={session} client={client} /></MemoryRouter>);

    await screen.findByLabelText('field-1');
    const submit = screen.getByRole('button', { name: '提交测试记录' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(upsertRecord).toHaveBeenCalledWith(session, 'task-opaque', {
      operation: 'UPSERT_RECORD', recordKindId: 'kind-opaque', schemaVersion: 'schema-test-v1',
      expectedRecordVersion: null, entries: [{ fieldId: 'field-1', value: '' }],
    }));
  });

  it('fails closed when the post-write authoritative context does not match the command target', async () => {
    const editableContext = {
      ...context,
      schema: {
        ...context.schema,
        recordKinds: [{
          id: 'kind-opaque',
          fields: [{ id: 'field-1', valueType: 'STRING' as const, required: true }],
          allowedActions: ['UPSERT_RECORD' as const],
        }],
      },
    };
    const mismatchedContext = { ...editableContext, taskId: 'other-task' };
    const getContext = vi.fn().mockResolvedValueOnce(editableContext).mockResolvedValueOnce(mismatchedContext);
    const upsertRecord = vi.fn().mockResolvedValue({
      businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1,
      schemaVersion: 'schema-test-v1', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
    });
    const client = { getContext, upsertRecord } as unknown as P11Client;

    render(<MemoryRouter><P11RecordPage taskId="task-opaque" session={session} client={client} /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText('field-1'), { target: { value: 'opaque-entry' } });
    fireEvent.click(screen.getByRole('button', { name: '提交测试记录' }));
    expect(await screen.findByTestId('p11-record-context-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('p11-context-error-code')).toHaveTextContent('RECORD_RESPONSE_INVALID');
    expect(screen.queryByTestId('p11-record-write-status')).not.toBeInTheDocument();
    expect(getContext).toHaveBeenCalledTimes(2);
  });

  it('keeps the authoritative record and disables the editor for a state-blocked write', async () => {
    const blockedContext = {
      ...context,
      schema: {
        ...context.schema,
        recordKinds: [{
          id: 'kind-opaque',
          fields: [{ id: 'field-1', valueType: 'STRING' as const, required: true }],
          allowedActions: ['UPSERT_RECORD' as const],
        }],
      },
      records: [{
        recordId: 'record-opaque', recordKindId: 'kind-opaque', recordVersion: 1,
        schemaVersion: 'schema-test-v1', entries: [{ fieldId: 'field-1', value: 'existing-entry' }],
      }],
    };
    const getContext = vi.fn().mockResolvedValue(blockedContext);
    const upsertRecord = vi.fn().mockRejectedValue(new P11ClientError(
      'blocked', 409, 'RECORD_STATE_BLOCKED', [], 'request-1', 'DISABLE_EDITOR',
    ));
    const client = { getContext, upsertRecord } as unknown as P11Client;

    render(<MemoryRouter><P11RecordPage taskId="task-opaque" session={session} client={client} /></MemoryRouter>);

    const input = await screen.findByLabelText('field-1');
    fireEvent.change(input, { target: { value: 'rejected-local-draft' } });
    fireEvent.click(screen.getByRole('button', { name: '提交测试记录' }));
    expect(await screen.findByTestId('p11-context-inline-error')).toBeInTheDocument();
    expect(screen.getByTestId('p11-context-error-code')).toHaveTextContent('RECORD_STATE_BLOCKED');
    expect(screen.getByTestId('p11-context-record-count')).toHaveTextContent('1');
    expect(input).toHaveValue('existing-entry');
    expect(input).toBeDisabled();
  });

  it('fails closed when write success and reread drift from the submitted schema', async () => {
    const editableContext = {
      ...context,
      schema: {
        ...context.schema,
        recordKinds: [{
          id: 'kind-opaque',
          fields: [{ id: 'field-1', valueType: 'STRING' as const, required: true }],
          allowedActions: ['UPSERT_RECORD' as const],
        }],
      },
    };
    const driftedContext = {
      ...editableContext,
      schema: { ...editableContext.schema, version: 'schema-test-v2' },
      records: [{
        recordId: 'record-opaque', recordKindId: 'kind-opaque', recordVersion: 1,
        schemaVersion: 'schema-test-v2', entries: [{ fieldId: 'field-1', value: 'opaque-entry' }],
      }],
    };
    const getContext = vi.fn().mockResolvedValueOnce(editableContext).mockResolvedValueOnce(driftedContext);
    const upsertRecord = vi.fn().mockResolvedValue({
      businessStatus: 'RECORD_WRITE_ACCEPTED', recordVersion: 1,
      schemaVersion: 'schema-test-v2', nextAction: 'GET_RECORD_CONTEXT', recoverableActions: [],
    });
    const client = { getContext, upsertRecord } as unknown as P11Client;

    render(<MemoryRouter><P11RecordPage taskId="task-opaque" session={session} client={client} /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText('field-1'), { target: { value: 'opaque-entry' } });
    fireEvent.click(screen.getByRole('button', { name: '提交测试记录' }));

    expect(await screen.findByTestId('p11-record-context-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('p11-context-error-code')).toHaveTextContent('RECORD_RESPONSE_INVALID');
    expect(screen.queryByTestId('p11-record-write-status')).not.toBeInTheDocument();
  });
});
