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
    // la devise vient de /plans et est mise en forme par Intl : « 25 000 FCFA » puis « / an »
    expect(within(pricing).getAllByText(/\/ an/).length).toBeGreaterThan(0);
    expect(within(pricing).getByText(/25.000.FCFA/)).toBeInTheDocument();
  });

  it("n'invente ni tarif ni devise quand l'API est injoignable", async () => {
    setTransport(async () => {
      throw new TypeError('offline');
    });
    renderApp(<Home />);
    const pricing = screen.getByRole('region', { name: /des tarifs/i });
    await waitFor(() => expect(within(pricing).getAllByText('Tarif indisponible pour le moment').length).toBe(3), { timeout: 4000 });
    expect(pricing.textContent).not.toMatch(/FCFA|XAF|\d{3}/);
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
