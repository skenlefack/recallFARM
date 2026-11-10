import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { api, listOf } from '../../api/endpoints';
import type { Plan } from '../../api/types';
import { Check } from '../../components/icons';
import { num } from '../../lib/format';
import { SiteFooter, SiteHeader, useDocumentTitle } from './SiteChrome';

import { priceOf, type Period } from '../../lib/plans';

function Price({ plans, code, period, loading }: { plans: Plan[] | undefined; code: string; period: Period; loading: boolean }) {
  if (loading) return <div className="price" aria-busy="true"><span className="price-skel" /></div>;
  const { amount, from } = priceOf(plans?.find((p) => p.code === code), code, period);
  if (amount === null) return <div className="price">Sur devis</div>;
  const unit = amount === 0 ? 'FCFA' : `FCFA / ${period === 'yearly' ? 'an' : 'mois'}`;
  return (
    <div className="price">
      {from && <small>dès </small>}
      {num(amount)} <small>{unit}</small>
    </div>
  );
}

function Pricing() {
  const [period, setPeriod] = useState<Period>('monthly');
  const q = useQuery({ queryKey: ['plans', 'CM'], queryFn: () => api.plans('CM'), select: (x) => listOf(x), retry: 1, staleTime: 3_600_000 });
  const plans = q.isError ? undefined : q.data;
  const loading = q.isLoading;
  return (
    <section id="tarifs" className="light tarifs on-light" aria-labelledby="tarifs-title">
      <div className="wrap section tarifs-inner">
        <div className="tarifs-head">
          <h2 id="tarifs-title" className="h2">Des tarifs à la mesure de la ferme</h2>
          <div role="group" aria-label="Périodicité" className="seg-toggle">
            <button type="button" aria-pressed={period === 'monthly'} onClick={() => setPeriod('monthly')}>
              Mensuel
            </button>
            <button type="button" aria-pressed={period === 'yearly'} onClick={() => setPeriod('yearly')}>
              Annuel · 2 mois offerts
            </button>
          </div>
        </div>
        <div className="plans" aria-live="polite">
          <article className="plan">
            <h3>Découverte</h3>
            <Price plans={plans} code="decouverte" period={period} loading={loading} />
            <ul>
              <li>1 exploitation</li>
              <li>Carnet et rappels sur le téléphone</li>
              <li>Journal, stocks, ventes</li>
              <li>Marché et vétérinaires</li>
            </ul>
            <a href="#demarrer" className="pill pill-outline-dark">
              Commencer
            </a>
          </article>
          <article className="plan plan-pro">
            <div className="plan-top">
              <h3>Pro</h3>
              <span className="badge-lime">Le plus choisi</span>
            </div>
            <Price plans={plans} code="pro" period={period} loading={loading} />
            <ul>
              <li>Rappels SMS et WhatsApp</li>
              <li>Certificats QR, généalogie</li>
              <li>Trésorerie et simulateur</li>
              <li>Dressage, pension, facturation</li>
              <li>3 exploitations, 2 caméras</li>
            </ul>
            <a href="#demarrer" className="pill pill-lime">
              Choisir Pro
            </a>
          </article>
          <article className="plan">
            <h3>Structure</h3>
            <Price plans={plans} code="structure" period={period} loading={loading} />
            <ul>
              <li>Multi-utilisateurs, mode agent</li>
              <li>Campagnes et couverture</li>
              <li>Studio : vos protocoles et champs</li>
              <li>Prix selon le nombre d'éleveurs suivis</li>
            </ul>
            <a href="#demo" className="pill pill-outline-dark">
              Parler à l'équipe
            </a>
          </article>
          <article className="plan">
            <h3>Institution</h3>
            <div className="price">Sur devis</div>
            <ul>
              <li>Surveillance nationale</li>
              <li>Exports DHIS2, ARIS, ICAR</li>
              <li>Hébergement souverain</li>
              <li>API et marque blanche</li>
            </ul>
            <a href="#demo" className="pill pill-outline-dark">
              Nous contacter
            </a>
          </article>
        </div>
        <p className="tarifs-note">
          Paiement par Orange Money, MTN MoMo, Wave, Moov, Airtel Money selon le pays. Option « Ferme connectée » : prix du kit et du forfait sur devis.
        </p>
      </div>
    </section>
  );
}

export function LeadForm() {
  const [phone, setPhone] = useState('');
  const [localErr, setLocalErr] = useState<string | null>(null);
  const m = useMutation({ mutationFn: (p: string) => api.lead({ phone: p, source: 'site_public' }) });
  const serverErr = m.error instanceof ApiError ? (m.error.fields?.phone ?? m.error.message) : m.error ? 'Envoi impossible pour le moment. Réessayez.' : null;
  const err = localErr ?? serverErr;

  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = phone.replace(/[\s.-]/g, '');
    if (!/^\+?\d{9,15}$/.test(clean)) {
      setLocalErr('Saisissez un numéro complet, par exemple +237 6 99 12 34 56.');
      return;
    }
    setLocalErr(null);
    m.mutate(clean.startsWith('+') ? clean : clean.length === 9 ? `+237${clean}` : `+${clean}`);
  }

  if (m.isSuccess)
    return (
      <div className="lead-done" role="status">
        <Check size={22} />
        <span>
          <b>C'est noté.</b> Un conseiller vous rappelle au {phone} sous 24 h ouvrées.
        </span>
      </div>
    );

  return (
    <form aria-label="Être rappelé" className="lead-form" onSubmit={submit} noValidate>
      <label htmlFor="tel" className="sr-only">
        Numéro de téléphone
      </label>
      <input
        id="tel"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+237 6 XX XX XX XX"
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          setLocalErr(null);
          if (m.isError) m.reset();
        }}
        aria-invalid={!!err}
        aria-describedby="tel-msg"
        required
      />
      <button type="submit" disabled={m.isPending}>
        {m.isPending ? 'Envoi…' : 'Être rappelé'}
      </button>
      <p id="tel-msg" className={`lead-msg${err ? ' err' : ''}`} role={err ? 'alert' : undefined}>
        {err ?? ''}
      </p>
    </form>
  );
}

export default function Home() {
  useDocumentTitle('RecallFarm · Ne ratez plus aucun vaccin');
  return (
    <div className="site">
      <a href="#main" className="skip-link">
        Aller au contenu
      </a>
      <SiteHeader />
      <main id="main">
        <section id="top" className="hero" aria-labelledby="hero-title">
          <svg className="hero-bg" viewBox="0 0 1440 760" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs>
              <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="#BFE3FB" />
              </pattern>
            </defs>
            <rect width="1440" height="760" fill="url(#dots)" opacity="0.35" />
            <circle cx="1060" cy="380" r="300" fill="none" stroke="#4FA9EA" />
            <circle cx="1060" cy="380" r="220" fill="none" stroke="#6BB8EE" strokeDasharray="2 6" />
            <circle cx="1060" cy="380" r="380" fill="none" stroke="#3C9DE4" />
          </svg>
          <div className="wrap hero-inner">
            <div className="hero-copy">
              <div className="hero-kicker">
                <span className="dot" />
                Gestion d'élevage · Afrique
              </div>
              <h1 id="hero-title">
                Ne ratez plus aucun vaccin.
                <br />
                <em>Pilotez toute votre ferme,</em> même sans réseau.
              </h1>
              <p className="hero-lead">
                Carnet sanitaire, rappels par SMS et USSD, suivi de la production, capteurs et caméras : une seule application, paramétrée pour votre filière et votre pays.
              </p>
              <div className="hero-ctas">
                <a href="#demarrer" className="pill pill-lime">
                  Commencer gratuitement
                </a>
                <a href="#demo" className="pill pill-ghost">
                  Demander une démonstration
                </a>
              </div>
              <ul className="hero-checks">
                <li>
                  <Check />
                  Fonctionne hors ligne
                </li>
                <li>
                  <Check />
                  SMS, USSD, WhatsApp
                </li>
                <li>
                  <Check />
                  Paiement mobile money
                </li>
              </ul>
            </div>

            <div className="hero-visual" role="img" aria-label="Aperçu de l'application : rappels du jour, température du poulailler et plan d'envoi des rappels">
              <div className="phone" aria-hidden="true">
                <div className="phone-screen">
                  <div className="phone-date">Mardi 27 octobre · Ferme de Mfou</div>
                  <div className="phone-title">Rappels du jour</div>
                  <div className="rcard rcard-now">
                    <div className="rcard-tag">AUJOURD'HUI · NEWCASTLE</div>
                    <div className="rcard-title">Bande B02 · 197 sujets</div>
                    <div className="rcard-sub">Rappel programmé · voie oculaire</div>
                  </div>
                  <div className="rcard rcard-soon">
                    <div className="rcard-tag">DANS 3 JOURS · RAGE</div>
                    <div className="rcard-title">« Rex » · berger allemand</div>
                    <div className="rcard-sub">Rappel annuel obligatoire</div>
                  </div>
                  <div className="mini-kpis">
                    <div>
                      <b>76 %</b>
                      <span>ponte</span>
                    </div>
                    <div>
                      <b>1,9</b>
                      <span>IC</span>
                    </div>
                    <div>
                      <b>2,1 %</b>
                      <span>mortalité</span>
                    </div>
                  </div>
                  <div className="phone-sync">
                    <span className="dot" />
                    Hors ligne · 3 saisies en attente
                  </div>
                </div>
              </div>
              <div className="float float-temp" aria-hidden="true">
                <div className="float-row">
                  <span>Poulailler 2</span>
                  <span className="live">● en direct</span>
                </div>
                <div className="val">
                  31,4<small> °C</small>
                </div>
                <svg viewBox="0 0 188 46" width="100%" height="46">
                  <line x1="0" y1="12" x2="188" y2="12" stroke="#F4B04F" strokeDasharray="3 4" strokeWidth="1" />
                  <polyline points="0,38 18,36 36,33 54,34 72,28 90,25 108,22 126,19 144,17 162,15 188,14" fill="none" stroke="#8FE3FF" strokeWidth="1.6" />
                </svg>
                <div className="thr">Seuil d'alerte 32 °C</div>
              </div>
              <div className="float float-plan" aria-hidden="true">
                <div className="lbl">Rappel envoyé · J-1</div>
                <div className="plan-track">
                  <span className="seg" />
                  <span className="node" />
                  <span className="seg" />
                  <span className="node" />
                  <span className="seg off" />
                  <span className="node ring" />
                  <span className="seg off" />
                  <span className="node off" />
                </div>
                <div className="plan-days">
                  <span>J-7</span>
                  <span>J-1</span>
                  <span>J</span>
                  <span>J+3</span>
                </div>
                <div className="chan">SMS · WhatsApp · notification</div>
              </div>
            </div>
          </div>
        </section>

        <section aria-label="Filières couvertes" className="band">
          <div className="wrap band-inner">
            <span className="eyebrow">Six filières, un seul outil</span>
            {['Volaille', 'Porcins', 'Petits ruminants', 'Bovins', 'Lapins'].map((f) => (
              <span key={f} style={{ display: 'contents' }}>
                <span className="band-item">{f}</span>
                <span className="band-sep" aria-hidden="true">
                  /
                </span>
              </span>
            ))}
            <span className="band-item">Chiens : élevage, dressage, pension</span>
          </div>
        </section>

        <section id="produit" className="light on-light" aria-labelledby="produit-title">
          <div className="wrap section produit-inner">
            <div className="head-split">
              <h2 id="produit-title" className="h2">
                Pensé pour le terrain africain, pas adapté après coup.
              </h2>
              <p className="lead-dark">
                Les grands logiciels mondiaux supposent une connexion permanente et une carte bancaire. RecallFarm part du réseau, du téléphone et du mode de paiement de l'éleveur.
              </p>
            </div>
            <div className="promises">
              <article className="card-sand">
                <div className="num">01</div>
                <h3>Paramétré pour vous</h3>
                <p>
                  Protocoles vaccinaux nationaux, formulaires, indicateurs et calendriers propres à votre filière, validés par des vétérinaires. Une nouvelle filière arrive sans mise à jour de l'application.
                </p>
              </article>
              <article className="card-sand">
                <div className="num">02</div>
                <h3>Hors ligne d'abord</h3>
                <p>Tout se saisit sans réseau, sur un téléphone d'entrée de gamme. Les données se synchronisent dès qu'une connexion passe, sans doublon ni perte.</p>
              </article>
              <article className="card-sand">
                <div className="num">03</div>
                <h3>Alerté au bon moment</h3>
                <p>Rappels à J-7, J-1, le jour J et en rattrapage, par notification, SMS, USSD ou WhatsApp. Pour l'éleveur sans smartphone aussi.</p>
              </article>
            </div>

            <div className="bento">
              <article className="tile-blue">
                <div className="copy">
                  <div className="eyebrow">Carnet et rappels</div>
                  <h3>Chaque vaccin programme le suivant.</h3>
                  <p>
                    Enregistrez un acte : le prochain rappel est calculé selon le protocole de votre pays. Délais d'attente, certificats antirabiques à QR code et blocage des ventes à risque inclus.
                  </p>
                </div>
                <ol className="frise-mini" aria-label="Frise d'un protocole de vaccination">
                  <li>
                    <span className="d">J1</span>
                    <span className="b">Marek</span>
                  </li>
                  <li>
                    <span className="d">J7</span>
                    <span className="b">Newcastle + bronchite</span>
                  </li>
                  <li>
                    <span className="d">J12</span>
                    <span className="b">Gumboro</span>
                  </li>
                  <li className="now">
                    <span className="d">J19</span>
                    <span className="b">Rappel Newcastle · aujourd'hui</span>
                  </li>
                </ol>
              </article>
              <article className="tile-white">
                <div className="eyebrow">Généalogie</div>
                <h3>Évitez la consanguinité</h3>
                <svg viewBox="0 0 220 96" width="100%" height="96" role="img" aria-label="Arbre généalogique sur deux générations">
                  <g fill="none" stroke="#B9B2A1" strokeWidth="1.2">
                    <path d="M110 70V54M60 54h100M60 54V38M160 54V38M60 38v0M35 22h50M60 38V22M135 22h50M160 38V22" />
                  </g>
                  <g fill="#F3F1EA" stroke="#062B4F" strokeWidth="1.2">
                    <circle cx="35" cy="16" r="6" />
                    <circle cx="85" cy="16" r="6" />
                    <circle cx="135" cy="16" r="6" />
                    <circle cx="185" cy="16" r="6" />
                    <circle cx="60" cy="40" r="7" />
                    <circle cx="160" cy="40" r="7" />
                  </g>
                  <circle cx="110" cy="78" r="9" fill="#C8F169" stroke="#062B4F" strokeWidth="1.2" />
                </svg>
                <p>Coefficient calculé avant chaque saillie, même hors ligne. Alerte au-delà de 6,25 %.</p>
              </article>
              <article className="tile-white">
                <div className="eyebrow">Simulateur</div>
                <h3>Testez avant d'investir</h3>
                <svg viewBox="0 0 220 80" width="100%" height="80" role="img" aria-label="Barres de marge par scénario">
                  <line x1="0" y1="72" x2="220" y2="72" stroke="#B9B2A1" />
                  <rect x="14" y="44" width="34" height="28" rx="4" fill="#DED9CC" />
                  <rect x="66" y="30" width="34" height="42" rx="4" fill="#DED9CC" />
                  <rect x="118" y="18" width="34" height="54" rx="4" fill="#062B4F" />
                  <rect x="170" y="8" width="34" height="64" rx="4" fill="#C8F169" stroke="#062B4F" strokeWidth="1" />
                </svg>
                <p>Effectifs, aliment, eau, marge : six filières modélisées à partir de références zootechniques.</p>
              </article>
              <article className="tile-white">
                <div className="eyebrow">Marché</div>
                <h3>Un vétérinaire en un geste</h3>
                <p>
                  Depuis un rappel manqué, demandez une visite à un vétérinaire, un inséminateur ou un fournisseur proche. Il reçoit la demande dans l'application et sur WhatsApp.
                </p>
              </article>
              <article className="tile-white">
                <div className="eyebrow">Économie</div>
                <h3>Votre marge, mois par mois</h3>
                <p>Ventes, dépenses, stocks d'aliment et de vaccins, coût de revient par œuf, par kilo ou par chiot, dans votre devise.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="suivi" aria-labelledby="suivi-title">
          <div className="wrap section suivi-inner">
            <div className="suivi-copy">
              <div className="eyebrow">Suivi à distance</div>
              <h2 id="suivi-title" className="h2">
                Votre ferme vous appelle avant qu'il ne soit trop tard.
              </h2>
              <p className="lead">
                Capteurs de température, d'eau et d'air, caméras, contacts de porte : la passerelle de ferme déclenche la sirène et envoie un SMS même quand Internet est coupé. Une alerte non prise en charge passe à votre gardien, puis par appel vocal.
              </p>
              <ul className="chips">
                <li>Chaleur</li>
                <li>Coupure d'eau</li>
                <li>Ammoniac</li>
                <li>Intrusion</li>
                <li>Mise-bas de nuit</li>
              </ul>
              <p className="suivi-note">Matériel standard (LoRaWAN, MQTT, ONVIF) posé par des installateurs partenaires · option « Ferme connectée ».</p>
            </div>
            <div className="sensors" role="img" aria-label="Exemple de tableau de capteurs : poulailler 1 normal, poulailler 2 en attention à 31,4 °C, château d'eau à 72 %, caméra de la maternité en direct">
              <div className="sensor" aria-hidden="true">
                <div className="row">
                  <span>Poulailler 1</span>
                  <span className="ok">normal</span>
                </div>
                <div className="val">28,2°</div>
                <div className="track">
                  <span style={{ width: '58%' }} />
                </div>
                <div className="foot">Humidité 64 % · NH₃ 12 ppm</div>
              </div>
              <div className="sensor warn" aria-hidden="true">
                <div className="row">
                  <span>Poulailler 2</span>
                  <span className="state">attention</span>
                </div>
                <div className="val">31,4°</div>
                <div className="track">
                  <span style={{ width: '86%' }} />
                </div>
                <div className="foot">Seuil 32 °C dans 6 min</div>
              </div>
              <div className="sensor" aria-hidden="true">
                <div className="row">
                  <span>Château d'eau</span>
                  <span className="ok">normal</span>
                </div>
                <div className="val">72 %</div>
                <svg viewBox="0 0 200 30" width="100%" height="30">
                  <polyline points="0,8 30,10 60,12 90,15 120,17 150,8 180,10 200,12" fill="none" stroke="#8FE3FF" strokeWidth="1.5" />
                </svg>
              </div>
              <div className="sensor" aria-hidden="true">
                <div className="row">
                  <span>Maternité · caméra</span>
                  <span className="live">● direct</span>
                </div>
                <div className="cam">flux basse résolution</div>
                <div className="foot">Mouvement détecté · 02:14</div>
              </div>
            </div>
          </div>
        </section>

        <section id="pourqui" className="light on-light" aria-labelledby="pourqui-title">
          <div className="wrap section pourqui-inner">
            <h2 id="pourqui-title" className="h2">
              Pour chaque maillon de l'élevage
            </h2>
            <div className="audiences">
              {[
                ['Éleveurs', 'Carnet, rappels, journal en une minute, marge et ventes. Gratuit pour démarrer.'],
                ['Coopératives et projets', 'Mode agent, import de vos membres, campagnes et tableaux de bord consolidés.'],
                ['Vétérinaires', "Clientèle, tournée des rappels manqués, certificats et factures, même pour l'éleveur sans smartphone."],
                ['Professionnels canins', "Élevage, dressage, pension : admission bloquée si la rage n'est pas à jour, facturation, paiement mobile."],
                ['Services vétérinaires', 'Couverture vaccinale par zone, carte de la rage, exports DHIS2 et ARIS, données anonymisées et consenties.'],
              ].map(([t, d]) => (
                <div key={t} className="audience">
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Pricing />

        <section id="confiance" className="confiance" aria-labelledby="confiance-title">
          <div className="wrap section confiance-inner">
            <div className="confiance-copy">
              <div className="eyebrow">Normes et données</div>
              <h2 id="confiance-title" className="h2">
                Conçu sur les références internationales. Vos données restent les vôtres.
              </h2>
              <ul className="norms" aria-label="Référentiels">
                <li>Code terrestre OMSA</li>
                <li>ICAR ADE</li>
                <li>ISO 11784/11785</li>
                <li>Convention de Malabo</li>
                <li>DHIS2</li>
                <li>ISO/IEC 27001 (visé)</li>
              </ul>
            </div>
            <ol className="pledges">
              <li>
                <span className="n">1</span>
                <div>
                  <h3>Vous possédez vos données</h3>
                  <p>Export complet et suppression du compte à tout moment.</p>
                </div>
              </li>
              <li>
                <span className="n">2</span>
                <div>
                  <h3>Rien d'individuel n'est revendu</h3>
                  <p>L'État ne reçoit que des chiffres agrégés, avec votre accord.</p>
                </div>
              </li>
              <li>
                <span className="n">3</span>
                <div>
                  <h3>Hébergées dans votre pays</h3>
                  <p>Ou avec l'autorisation de transfert exigée par la loi.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section id="demarrer" className="cta on-light" aria-labelledby="cta-title">
          <div id="demo" className="wrap cta-inner">
            <div className="cta-copy">
              <h2 id="cta-title">Votre premier rappel en cinq minutes.</h2>
              <p>Téléchargez l'application ou laissez votre numéro : un conseiller vous rappelle.</p>
            </div>
            <LeadForm />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
