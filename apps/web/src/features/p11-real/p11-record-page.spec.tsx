// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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
});
