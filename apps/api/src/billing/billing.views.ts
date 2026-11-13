import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';

/**
 * Response shapes of the billing endpoints (OpenAPI only: no validation, nothing is read from them).
 * They describe what BillingService / PaymentOpsService return, so that the web and mobile clients
 * can be generated (requests.md 2026-11-13, web-frontend P1.2).
 */

/** Object or null (OpenAPI 3.1): `nullable` is lost on a $ref, so it is written as oneOf. */
// eslint-disable-next-line @typescript-eslint/ban-types -- swagger takes the class constructor
function NullableRef(model: Function, description?: string): PropertyDecorator {
  return ApiProperty({ oneOf: [{ $ref: getSchemaPath(model) }, { type: 'null' }], ...(description ? { description } : {}) });
}

export const PAYMENT_STATUSES = ['initie', 'en_attente', 'a_verifier', 'confirme', 'echoue', 'remboursement_en_cours', 'rembourse'];

export class MoneyView {
  @ApiProperty({ example: 2500, description: 'Entier en unite mineure ISO 4217' }) amount_minor: number;
  @ApiProperty({ example: 'XAF', description: 'Code ISO 4217, venu du pack pays' }) currency: string;
}

export class PaymentEventView {
  @ApiProperty({ format: 'date-time', description: 'Reception de l’evenement (UTC)' }) at: string;
  @ApiProperty({ example: 'confirme', description: 'Statut annonce par le fournisseur (apres correspondance du connecteur)' }) status: string;
  @ApiProperty({
    enum: ['webhook', 'statut', 'operateur', 'client'],
    description:
      'Ecrite par l’API a l’enregistrement : webhook (notification du fournisseur), statut (requete de statut), operateur (decision d’un administrateur), client (confirmation explicite du payeur)',
  })
  source: 'webhook' | 'statut' | 'operateur' | 'client';
  @ApiPropertyOptional({ type: Boolean, description: 'Administration seulement, toujours true quand present : evenement recu mais non applique (jamais montre au payeur)' }) ignored?: true;
  @ApiPropertyOptional({ enum: ['montant', 'devise'], description: 'Raison du refus (avec ignored)' }) reason?: string;
  @ApiPropertyOptional({
    enum: ['repeat_confirmed', 'late_confirm_after_resolve'],
    description: 'repeat_confirmed : nouveau paiement confirme explicitement malgre un paiement confirme recent (PAY-RECENT) ; late_confirm_after_resolve : confirmation du fournisseur apres une decision « echoue » de l’operateur',
  })
  detail?: string;
}

export class PaymentView {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: PAYMENT_STATUSES }) status: string;
  @ApiProperty({ example: 'abonnement' }) purpose: string;
  @ApiProperty({ type: String, nullable: true, example: 'pro' }) plan: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'mensuel ou annuel' }) period: string | null;
  @ApiProperty({ type: MoneyView }) amount: MoneyView;
  @ApiProperty({ example: 'orange_money' }) method: string;
  @ApiProperty({ type: String, nullable: true }) provider_ref: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) paid_at: string | null;
  @ApiProperty({ format: 'date-time' }) created_at: string;
  @ApiProperty({
    type: [PaymentEventView],
    description:
      'Journal des evenements (20 derniers) : date, statut et source, sans corps brut ni donnees personnelles. Vue payeur : sans les evenements refuses ; vue administration : avec ignored et reason',
  })
  events: PaymentEventView[];
}

export class PaymentPollView {
  @ApiPropertyOptional({ description: 'Interrogations faites' }) count?: number;
  @ApiPropertyOptional({ format: 'date-time' }) last_at?: string;
  @ApiPropertyOptional({ format: 'date-time' }) next_at?: string;
  @ApiPropertyOptional({ description: 'Derniere reponse lue (statut du fournisseur ou code d’erreur)' }) last?: string;
}

export class RefundView {
  @ApiProperty({ format: 'uuid', description: 'Cle d’idempotence du remboursement (stable)' }) id: string;
  @ApiProperty({ enum: ['en_cours', 'en_attente', 'inconnu', 'a_verifier', 'rembourse', 'refuse'] }) status: string;
  @ApiProperty() reason: string;
  @ApiProperty({ format: 'date-time' }) requested_at: string;
  @ApiProperty({ format: 'uuid' }) requested_by: string;
  @ApiPropertyOptional({ description: 'Reference du remboursement chez le fournisseur' }) ref?: string;
  @ApiPropertyOptional({ format: 'date-time' }) done_at?: string;
  @ApiPropertyOptional() http_status?: number;
  @ApiPropertyOptional() error?: string;
  @ApiPropertyOptional({ type: PaymentPollView, description: 'Suivi par la requete de statut du remboursement' }) poll?: PaymentPollView;
}

export class AdminPaymentView extends PaymentView {
  @ApiProperty({ enum: ['user', 'organisation'] }) payer_type: string;
  @ApiProperty({ format: 'uuid' }) payer_id: string;
  @ApiProperty({ type: String, nullable: true, description: 'Connecteur qui a lance le paiement' }) connector: string | null;
  @ApiProperty({ type: String, nullable: true }) error_code: string | null;
  @NullableRef(PaymentPollView) poll: PaymentPollView | null;
  @NullableRef(RefundView) refund: RefundView | null;
  @ApiProperty({ description: 'true : a revoir par un operateur (ex. confirmation du fournisseur apres une decision « echoue »)' }) needs_review: boolean;
}

export class AdminPaymentListView {
  @ApiProperty({ type: [AdminPaymentView] }) data: AdminPaymentView[];
}

export class PaymentCheckView extends PaymentView {
  @ApiProperty({ description: 'false : paiement deja termine, le fournisseur n’a pas ete interroge' }) checked: boolean;
  @ApiPropertyOptional({ example: 'confirmed', description: 'Issue de l’interrogation (confirmed, failed, still_pending, flagged, errors, ou statut lu)' }) outcome?: string;
}

export class PaymentRefundView extends PaymentView {
  @NullableRef(RefundView) refund: RefundView | null;
}

export class CheckoutResultView {
  @ApiProperty({ format: 'uuid' }) payment_id: string;
  @ApiProperty({ example: 'initie', description: '"initie" tant que le paiement est ouvert ; sinon son statut (rejeu)' }) status: string;
  @ApiProperty({ description: 'Une demande de validation a ete envoyee sur le telephone' }) ussd_push: boolean;
  @ApiPropertyOptional({ description: 'Page de paiement du fournisseur, le cas echeant' }) redirect_url?: string;
  @ApiProperty({ type: MoneyView }) amount: MoneyView;
  @ApiProperty({ type: String, nullable: true }) provider_ref: string | null;
  @ApiPropertyOptional({ description: 'true : rejeu du meme id ou de la meme Idempotency-Key, aucun nouvel appel au fournisseur' }) replayed?: boolean;
}

export class ErrorDetailView {
  @ApiProperty({ enum: ['UNAUTHENTICATED', 'FORBIDDEN', 'PLAN_REQUIRED', 'NOT_FOUND', 'CONFLICT', 'VALIDATION_ERROR', 'BUSINESS_RULE', 'QUOTA_EXCEEDED', 'RATE_LIMITED', 'SERVER_ERROR'] })
  code: string;
  @ApiProperty() message: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } }) fields?: Record<string, string>;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'Regle (rule) et donnees utiles au client' }) details?: Record<string, unknown>;
}

/** Uniform error envelope (05 §Conventions, common/errors.ts). */
export class ErrorView {
  @ApiProperty({ type: ErrorDetailView }) error: ErrorDetailView;
}

export class PayOpenDetailsView {
  @ApiProperty({
    enum: ['PAY-OPEN', 'PAY-RECENT', 'PAY-IDEMPOTENCY', 'PAY-RETRY'],
    description:
      'PAY-RECENT : un paiement d’abonnement de ce payeur a ete confirme recemment (PAYMENT_RECENT_GUARD_MIN) ; renvoyer le meme checkout avec confirm_repeat: true pour payer encore. PAY-RETRY : le paiement ouvert vient de changer d’etat, reessayer',
  })
  rule: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'PAY-OPEN : paiement d’abonnement deja ouvert pour ce payeur (a suivre, pas a relancer) ; PAY-RECENT : paiement confirme recent' }) payment_id?: string;
  @ApiPropertyOptional({ enum: ['initie', 'en_attente', 'a_verifier'], description: 'PAY-OPEN : statut du paiement ouvert' }) status?: string;
  @ApiPropertyOptional({ example: 'pro', description: 'PAY-OPEN : formule du paiement ouvert (un seul paiement d’abonnement ouvert par compte, toutes formules) ; PAY-RECENT : formule payee' }) plan?: string;
  @ApiPropertyOptional({ format: 'date-time', description: 'PAY-RECENT : date de confirmation du paiement recent (UTC)' }) paid_at?: string;
}

export class CheckoutConflictDetailView {
  @ApiProperty({ enum: ['CONFLICT'] }) code: string;
  @ApiProperty() message: string;
  @ApiProperty({ type: PayOpenDetailsView }) details: PayOpenDetailsView;
}

export class CheckoutConflictView {
  @ApiProperty({ type: CheckoutConflictDetailView }) error: CheckoutConflictDetailView;
}

export class PlanMoneyPair {
  @ApiProperty({ type: MoneyView }) monthly: MoneyView;
  @ApiProperty({ type: MoneyView }) yearly: MoneyView;
}

export class PlanPricesView extends PlanMoneyPair {
  @ApiProperty({ description: 'Prix « a partir de » (ex. formule par tranche)' }) from: boolean;
}

export class PlanView {
  @ApiProperty({ example: 'pro' }) code: string;
  @ApiProperty() label: string;
  @ApiProperty() rank: number;
  @ApiProperty({ type: [String] }) features: string[];
  @ApiProperty({ type: 'object', additionalProperties: true }) quotas: Record<string, unknown>;
  @ApiProperty({ type: PlanPricesView }) prices: PlanPricesView;
  @ApiProperty({ description: 'false : pas de tarif dans le pack pays (gratuit ou sur devis)' }) purchasable: boolean;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
}

export class PlanCardView {
  @ApiProperty({ example: 'pro' }) code: string;
  @ApiProperty() name: string;
  @ApiProperty() rank: number;
  @ApiProperty({ type: [String] }) features: string[];
  @ApiProperty({ type: 'object', additionalProperties: true }) quotas: Record<string, unknown>;
  @NullableRef(MoneyView) monthly: MoneyView | null;
  @NullableRef(MoneyView) yearly: MoneyView | null;
  @NullableRef(PlanPricesView, 'null : sur devis') price: PlanPricesView | null;
}

export class PaymentMethodView {
  @ApiProperty({ example: 'orange_money' }) code: string;
  @ApiProperty({ example: 'Orange Money' }) label: string;
}

export class PlansView {
  @ApiProperty({ example: 'CM' }) country: string;
  @ApiProperty({ example: 'XAF', description: 'Devise du pack pays (ISO 4217)' }) currency: string;
  @ApiProperty({ type: [PlanCardView] }) data: PlanCardView[];
  @ApiProperty({ type: [PlanView] }) plans: PlanView[];
  @ApiProperty({ type: [PaymentMethodView] }) payment_methods: PaymentMethodView[];
}

export class ReconciliationDivergenceView {
  @ApiProperty() connector: string;
  @ApiProperty({ type: String, nullable: true }) payment_id: string | null;
  @ApiProperty({ type: String, nullable: true }) provider_ref: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Notre statut (null : inconnu en base)' }) base: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Statut du fournisseur (null : absent de sa liste)' }) fournisseur: string | null;
  @ApiProperty({ enum: ['statut', 'montant', 'inconnu_en_base', 'absent_chez_fournisseur'] }) ecart: string;
}

export class ReconciliationTotalsView {
  @ApiProperty() payments: number;
  @ApiProperty() confirmes: number;
  @ApiProperty({ type: [MoneyView] }) confirmed_amounts: MoneyView[];
}

export class ConfirmedWithoutSubscriptionView {
  @ApiProperty({ format: 'uuid' }) payment_id: string;
  @ApiProperty() payer_type: string;
  @ApiProperty({ format: 'uuid' }) payer_id: string;
  @ApiProperty({ type: String, nullable: true }) plan: string | null;
}

export class SubscriptionWithoutPaymentView {
  @ApiProperty({ format: 'uuid' }) subscription_id: string;
  @ApiProperty() account_type: string;
  @ApiProperty({ format: 'uuid' }) account_id: string;
  @ApiProperty() plan: string;
}

export class ConnectorReasonView {
  @ApiProperty() connector: string;
  @ApiProperty() raison: string;
}

export class PaymentErrorView extends ConnectorReasonView {
  @ApiProperty({ format: 'uuid' }) payment_id: string;
}

export class ReconciliationSourceView {
  @ApiProperty() connector: string;
  @ApiProperty({ enum: ['liste', 'statut'] }) source: string;
}

export class ReconciliationReportView {
  @ApiProperty({ example: '2026-11-09', description: 'Jour metier (fuseau du pays)' }) day: string;
  @ApiProperty({ format: 'date-time' }) generated_at: string;
  @ApiProperty({ type: ReconciliationTotalsView }) totals: ReconciliationTotalsView;
  @ApiProperty({ type: [ConfirmedWithoutSubscriptionView] }) confirmes_sans_abonnement: ConfirmedWithoutSubscriptionView[];
  @ApiProperty({ type: [SubscriptionWithoutPaymentView] }) abonnements_sans_paiement: SubscriptionWithoutPaymentView[];
  @ApiProperty({ type: [ReconciliationDivergenceView] }) divergences: ReconciliationDivergenceView[];
  @ApiProperty({ type: [ConnectorReasonView] }) non_verifies: ConnectorReasonView[];
  @ApiProperty({ type: [PaymentErrorView] }) erreurs: PaymentErrorView[];
  @ApiProperty({ description: 'false : une erreur temporaire a laisse des points non verifies (rapport refait)' }) complet: boolean;
  @ApiProperty({ type: [ReconciliationSourceView] }) sources: ReconciliationSourceView[];
}

export class StoredReconciliationView extends ReconciliationReportView {
  @ApiProperty({ format: 'date-time' }) updated_at: string;
}

export class ReconciliationListView {
  @ApiProperty({ type: [StoredReconciliationView] }) data: StoredReconciliationView[];
}

export class SubscriptionRefView {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['user', 'organisation'] }) account_type: string;
  @ApiProperty({ format: 'uuid' }) account_id: string;
}

export class CurrentSubscriptionView {
  @ApiProperty({ enum: ['user', 'organisation'] }) account_type: string;
  @ApiProperty({ format: 'uuid' }) account_id: string;
  @ApiProperty({ example: 'pro' }) plan: string;
  @ApiProperty({ enum: ['actif', 'grace', 'expire', 'gratuit'] }) status: string;
  @ApiProperty({ type: String, nullable: true, description: 'mensuel ou annuel' }) period: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) started_at: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) expires_at: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) grace_until: string | null;
  @NullableRef(MoneyView, 'null : abonnement gratuit, ou devise introuvable dans le pack pays (avertissement journalise)') price: MoneyView | null;
  @NullableRef(SubscriptionRefView) subscription: SubscriptionRefView | null;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Droits effectifs (formule, fonctions, quotas, source, jeton signe pour une organisation)' })
  entitlements: Record<string, unknown>;
}

/** Models referenced only through NullableRef (registered with @ApiExtraModels). */
export const BILLING_EXTRA_MODELS = [PaymentPollView, RefundView, MoneyView, PlanPricesView, SubscriptionRefView];
