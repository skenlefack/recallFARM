import { ApiProperty } from '@nestjs/swagger';

/** Response shapes of the connector administration (OpenAPI only). */

export class ConnectorSummaryView {
  @ApiProperty({ example: 'agregateur_cm' }) name: string;
  @ApiProperty({ example: 'Agregateur Cameroun' }) label: string;
  @ApiProperty({ type: [String], enum: ['sms', 'whatsapp', 'ussd', 'payment'] }) channels: string[];
  @ApiProperty({ type: [String], example: ['sms', 'payment:orange_money'], description: 'Canaux et moyens de paiement routes vers ce connecteur' }) routed_for: string[];
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Evenements de paiement envoyes par ce connecteur pour un paiement d’un autre connecteur, refuses sans ecriture (depuis le demarrage de l’instance)',
  })
  foreign_payment_events: number;
}

export class ConnectorSummaryListView {
  @ApiProperty({ type: [ConnectorSummaryView] }) data: ConnectorSummaryView[];
}
