import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '../../api/client';
import { api, listOf } from '../../api/endpoints';
import type { Member, OrgRole } from '../../api/types';
import { Card, Dialog, EmptyState, ErrorState, FieldErrors, Pill, SkeletonRows, useToast } from '../../components/ui';
import { initials, phone as fmtPhone, ROLE_LABEL, since } from '../../lib/format';
import { useAuth } from '../auth';
import { usePageMeta } from '../hooks';
import { normalizePhone } from './Login';

const ROLES: { value: OrgRole; label: string; desc: string }[] = [
  { value: 'admin', label: 'Administrateur', desc: 'Tout, y compris les membres, l’abonnement et le studio.' },
  { value: 'agent', label: 'Agent de terrain', desc: 'Saisit pour les éleveurs qui lui sont confiés, même hors ligne.' },
  { value: 'veterinaire', label: 'Vétérinaire', desc: 'Voit les rappels et alertes, relit les protocoles.' },
  { value: 'membre', label: 'Membre', desc: 'Consulte le tableau de bord et les exports.' },
];

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { orgId } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tel, setTel] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<OrgRole>('agent');
  const m = useMutation({
    mutationFn: () => api.inviteMember(orgId!, { phone: normalizePhone(tel), role, name: name.trim() || undefined }),
    onSuccess: () => {
      toast(`Invitation envoyée par SMS au ${tel}.`);
      qc.invalidateQueries({ queryKey: ['members'] });
      setTel('');
      setName('');
      onClose();
    },
  });
  const phoneErr = m.error instanceof ApiError ? m.error.fields?.phone : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <Dialog
      open={open}
      onClose={() => (m.reset(), onClose())}
      title="Inviter un membre"
      description="La personne reçoit un SMS avec un lien de connexion. Elle n'a besoin que de son numéro."
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="invite-form" className="btn btn-primary" disabled={m.isPending || !tel.trim()}>
            {m.isPending ? 'Envoi…' : "Envoyer l'invitation"}
          </button>
        </>
      }
    >
      <form id="invite-form" className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="inv-phone">Téléphone</label>
          <input id="inv-phone" className="input" type="tel" inputMode="tel" placeholder="+237 6 XX XX XX XX" value={tel} onChange={(e) => setTel(e.target.value)} aria-invalid={!!phoneErr} aria-describedby={phoneErr ? 'inv-phone-err' : undefined} data-autofocus />
          {phoneErr && <span id="inv-phone-err" className="field-err">{phoneErr}</span>}
        </div>
        <div className="field">
          <label htmlFor="inv-name">Nom (facultatif)</label>
          <input id="inv-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
          <legend style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500, marginBottom: 6 }}>Rôle</legend>
          {ROLES.map((r) => (
            <label key={r.value} className="method" style={{ alignItems: 'flex-start' }}>
              <input type="radio" name="role" value={r.value} checked={role === r.value} onChange={() => setRole(r.value)} style={{ marginTop: 3 }} />
              <span>
                {r.label}
                <span className="cell-sub" style={{ fontWeight: 400 }}>
                  {r.desc}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {m.error && !phoneErr && <FieldErrors error={m.error} />}
      </form>
    </Dialog>
  );
}

function RoleSelect({ member }: { member: Member }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useAuth();
  const m = useMutation({
    mutationFn: (role: OrgRole) => api.patchMember(member.id, { role }),
    onSuccess: (_x, role) => {
      toast(`${member.name ?? fmtPhone(member.phone)} est maintenant ${ROLE_LABEL[role]?.toLowerCase()}.`);
      qc.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (e) => {
      toast(errorMessage(e), 'err');
      qc.invalidateQueries({ queryKey: ['members'] });
    },
  });
  const self = member.user_id === me?.id;
  return (
    <>
      <label htmlFor={`role-${member.id}`} className="sr-only">
        Rôle de {member.name ?? member.phone}
      </label>
      <select id={`role-${member.id}`} className="input input-sm" style={{ width: 'auto' }} value={member.role} disabled={m.isPending || self} title={self ? 'Vous ne pouvez pas changer votre propre rôle' : undefined} onChange={(e) => m.mutate(e.target.value as OrgRole)}>
        {ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
    </>
  );
}

export default function Users() {
  usePageMeta('Utilisateurs', 'Membres de la Structure et rôles');
  const { orgId, me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const q = useQuery({ queryKey: ['members', orgId], queryFn: () => api.members(orgId!), select: listOf, enabled: !!orgId });
  const rm = useMutation({
    mutationFn: (mem: Member) => api.removeMember(mem.id),
    onSuccess: () => {
      toast('Accès retiré.');
      qc.invalidateQueries({ queryKey: ['members'] });
      setRemoving(null);
    },
  });

  if (!orgId) return <EmptyState title="Aucune organisation">Ce compte n'administre pas de Structure.</EmptyState>;

  return (
    <>
      <div className="toolbar">
        <span className="muted">{q.data ? `${q.data.length} membre${q.data.length > 1 ? 's' : ''}` : ''}</span>
        <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}>
          Inviter un membre
        </button>
      </div>
      <Card id="members" title="Équipe" padded>
        {q.isLoading ? (
          <SkeletonRows rows={5} cols={4} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState title="Vous êtes seul pour l'instant" action={<button type="button" className="btn btn-primary" onClick={() => setInviting(true)}>Inviter un agent</button>}>
            Invitez vos agents de terrain et votre vétérinaire : ils saisissent pour les éleveurs, même hors ligne.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th scope="col">Membre</th>
                  <th scope="col">Rôle</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Dernière activité</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((mem) => (
                  <tr key={mem.id}>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <span className="avatar" style={{ width: 34, height: 34, fontSize: 12, boxShadow: 'none' }} aria-hidden="true">
                          {mem.name ? initials(mem.name) : '?'}
                        </span>
                        <span>
                          {mem.name ?? <span className="muted">Invitation en attente</span>}
                          {mem.user_id === me?.id && <span className="muted"> (vous)</span>}
                          <span className="cell-sub mono">{fmtPhone(mem.phone)}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <RoleSelect member={mem} />
                    </td>
                    <td>{mem.status === 'actif' ? <Pill tone="ok">Actif</Pill> : <Pill tone="warn">Invité</Pill>}</td>
                    <td className="num">{mem.last_seen_at ? `il y a ${since(mem.last_seen_at)}` : '—'}</td>
                    <td className="right">
                      {mem.user_id !== me?.id && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoving(mem)} aria-label={`Retirer ${mem.name ?? mem.phone}`}>
                          Retirer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
      <Dialog
        open={!!removing}
        onClose={() => (rm.reset(), setRemoving(null))}
        title="Retirer ce membre ?"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRemoving(null)} data-autofocus>
              Annuler
            </button>
            <button type="button" className="btn btn-danger" onClick={() => removing && rm.mutate(removing)} disabled={rm.isPending}>
              {rm.isPending ? 'Retrait…' : 'Retirer l’accès'}
            </button>
          </>
        }
      >
        <p>
          {removing?.name ?? fmtPhone(removing?.phone)} ne pourra plus se connecter à l'espace de la Structure. Les saisies déjà faites restent dans l'historique.
        </p>
        <FieldErrors error={rm.error} />
      </Dialog>
    </>
  );
}
