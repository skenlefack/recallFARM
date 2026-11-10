import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { setTransport } from '../api/client';
import { session } from '../api/session';
import { mockTransport } from '../mocks/server';
import { renderApp } from '../test/utils';
import Login from './pages/Login';

afterEach(() => {
  setTransport(null);
  session.clear();
});

describe('OTP login', () => {
  it('requests a code, shows the dev code hint, verifies and stores the session', async () => {
    setTransport(mockTransport);
    renderApp(
      <Routes>
        <Route path="/admin/login" element={<Login />} />
        <Route path="/admin" element={<p>Tableau atteint</p>} />
      </Routes>,
      '/admin/login',
    );
    await userEvent.type(screen.getByLabelText('Numéro de téléphone'), '690000002');
    await userEvent.click(screen.getByRole('button', { name: 'Recevoir le code' }));
    expect(await screen.findByText(/le code est/)).toHaveTextContent('123456');
    await userEvent.type(screen.getByLabelText('Code reçu par SMS'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/code incorrect/i);
    await userEvent.clear(screen.getByLabelText('Code reçu par SMS'));
    await userEvent.type(screen.getByLabelText('Code reçu par SMS'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText('Tableau atteint')).toBeInTheDocument();
    expect(session.isAuthenticated).toBe(true);
  });
});
