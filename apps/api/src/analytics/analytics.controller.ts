import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { PlatformRoles } from '../common/auth';
import { AggregationService } from './aggregation.service';

class DashboardQueryDto {
  @ApiProperty() @IsString() from: string;
  @ApiProperty() @IsString() to: string;
}

@ApiTags('analytics')
@ApiBearerAuth()
// The global prefix already adds /v1 (the route was /v1/v1/admin/analytics).
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly aggregation: AggregationService) {}

  @PlatformRoles('platform_admin', 'epidemiologiste')
  @Get('dashboard')
  dashboard(@Query() q: DashboardQueryDto) {
    return this.aggregation.dashboard(q.from, q.to);
  }
}
