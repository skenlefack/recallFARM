import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormRenderer, toPayload, validate, type FormDef } from './FormRenderer';

const pack = JSON.parse(readFileSync(resolve(process.cwd(), '../../packages/params/packs/filiere.volaille.json'), 'utf8'));
const form = pack.objects.find((o: { code: string }) => o.code === 'daily_log_volaille') as FormDef;
const i18n = pack.i18n.fr as Record<string, string>;

describe('FormRenderer with filiere.volaille daily_log_volaille', () => {
  it('shows laying fields only for a laying batch (visible_if)', () => {
    const { unmount } = render(<FormRenderer form={form} i18n={i18n} ctx={{ subject: { production_type: 'ponte' } }} />);
    expect(screen.getByRole('textbox', { name: /Œufs ramassés/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Poids moyen/)).not.toBeInTheDocument();
    unmount();
    render(<FormRenderer form={form} i18n={i18n} ctx={{ subject: { production_type: 'chair' } }} />);
    expect(screen.queryByRole('textbox', { name: /Œufs ramassés/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Poids moyen/)).toBeInTheDocument();
  });

  it('enforces required_if and builds columns + attributes on submit', async () => {
    const onSubmit = vi.fn();
    render(<FormRenderer form={form} i18n={i18n} ctx={{ subject: { production_type: 'ponte' } }} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tester la saisie' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Œufs ramassés est obligatoire/);
    await userEvent.type(screen.getByRole('textbox', { name: /Œufs ramassés/ }), '1512');
    await userEvent.click(screen.getByRole('button', { name: 'Tester la saisie' }));
    expect(onSubmit).toHaveBeenCalledWith({ columns: { eggs: 1512, mortality: 0 }, attributes: { behaviour: 'normal' } });
  });

  it('computes read-only fields with the expression engine', () => {
    const def: FormDef = {
      code: 't',
      fields: [
        { code: 'alive', type: 'integer', label: 'Vivants', default: 10 },
        { code: 'dead', type: 'integer', label: 'Morts', default: 2 },
        { code: 'rate', type: 'computed', label: 'Mortalité', unit: '%', expr: 'round(log.dead / (log.alive + log.dead) * 100, 1)' },
      ],
    };
    render(<FormRenderer form={def} />);
    expect(screen.getByText('16,7 %')).toBeInTheDocument();
  });

  it('validates min/max and patterns', () => {
    const def: FormDef = { code: 'dog', fields: [{ code: 'chip', type: 'rfid', label: 'Puce', pattern: '^[0-9]{15}$' }, { code: 'w', type: 'decimal', label: 'Poids', min: 0.3, max: 120, unit: 'kg' }] };
    expect(validate(def, { chip: '123', w: 200 }, {})).toEqual({ chip: expect.stringMatching(/15 chiffres/), w: 'Maximum 120 kg.' });
    expect(toPayload(def, { chip: '120093000418271', w: 34 }, {})).toEqual({ columns: {}, attributes: { chip: '120093000418271', w: 34 } });
  });
});
