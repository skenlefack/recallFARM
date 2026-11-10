import { afterEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { setTransport } from '../api/client';
import { session } from '../api/session';
import { mockTransport } from '../mocks/server';
import { renderApp } from '../test/utils';
import Workspace from './Workspace';

afterEach(() => {
  setTransport(null);
  session.clear();
});

describe('Studio workspace', () => {
  it('renders the protocol editor, frise, diff and test vectors from the API', async () => {
    setTransport(mockTransport);
    session.setTokens('mock-at.u-jeanmarc.1', 'mock-rt.u-jeanmarc.1', 'login');
    renderApp(
      <Routes>
        <Route path="/admin/studio/v/:versionId/:section" element={<Workspace />} />
      </Routes>,
      '/admin/studio/v/v-porcin-200/protocoles',
    );
    expect(await screen.findByRole('heading', { name: 'Porcelets, de la naissance au sevrage' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /Frise : fer j3/i })).toBeInTheDocument();
    expect(await screen.findByText('24 / 24 réussis', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByText('+ etape mycoplasme.rappel')).toBeInTheDocument();
    expect(screen.getByText('− fer.declencheur: +2 j')).toBeInTheDocument();
    const steps = screen.getByRole('region', { name: 'Étapes' });
    expect(within(steps).getByDisplayValue('animal.sexe == "M"')).toBeInTheDocument();
  });

  it('stops the author from reviewing their own version (RG-PAR-04)', async () => {
    setTransport(mockTransport);
    session.setTokens('mock-at.u-aicha.1', 'mock-rt.u-aicha.1', 'login');
    renderApp(
      <Routes>
        <Route path="/admin/studio/v/:versionId/:section" element={<Workspace />} />
      </Routes>,
      '/admin/studio/v/v-org-030/protocoles',
    );
    const btns = await screen.findAllByRole('button', { name: 'Relire et décider' });
    await userEvent.click(btns[0]);
    // the author is stopped before any request: no review dialog opens
    expect(screen.queryByRole('dialog', { name: 'Relecture vétérinaire' })).not.toBeInTheDocument();
    const notice = await screen.findByText(/Règle des quatre yeux · RG-PAR-04/);
    expect(notice.closest('[role="alert"]')).toHaveTextContent(/ne pouvez pas la relire vous-même/);
  });
});
