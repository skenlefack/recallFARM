import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTransport } from '../../api/client';
import { mockTransport } from '../../mocks/server';
import { renderApp } from '../../test/utils';
import Home from './Home';

afterEach(() => setTransport(null));

describe('Home pricing', () => {
  it('loads prices from /plans and toggles monthly / yearly', async () => {
    setTransport(mockTransport);
    renderApp(<Home />);
    const pricing = screen.getByRole('region', { name: /des tarifs/i });
    await waitFor(() => expect(within(pricing).getByText(/2.500/)).toBeInTheDocument());
    await userEvent.click(within(pricing).getByRole('button', { name: /annuel/i }));
    expect(within(pricing).getByRole('button', { name: /annuel/i })).toHaveAttribute('aria-pressed', 'true');
    expect(within(pricing).getByText(/25.000/)).toBeInTheDocument();
    expect(within(pricing).getAllByText(/FCFA \/ an/).length).toBeGreaterThan(0);
  });

  it('falls back to the static prices when the API is unreachable', async () => {
    setTransport(async () => {
      throw new TypeError('offline');
    });
    renderApp(<Home />);
    const pricing = screen.getByRole('region', { name: /des tarifs/i });
    await waitFor(() => expect(within(pricing).getByText(/15.000/)).toBeInTheDocument(), { timeout: 4000 });
    expect(within(pricing).getByText(/2.500/)).toBeInTheDocument();
  });
});

describe('Être rappelé form', () => {
  it('validates the phone then posts the lead', async () => {
    setTransport(mockTransport);
    renderApp(<Home />);
    const form = screen.getByRole('form', { name: 'Être rappelé' });
    const input = within(form).getByLabelText('Numéro de téléphone');
    await userEvent.type(input, '12');
    await userEvent.click(within(form).getByRole('button', { name: 'Être rappelé' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(/numéro complet/i);
    await userEvent.clear(input);
    await userEvent.type(input, '6 99 12 34 56');
    await userEvent.click(within(form).getByRole('button', { name: 'Être rappelé' }));
    expect(await screen.findByText(/C'est noté/)).toBeInTheDocument();
  });
});
