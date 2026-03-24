import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

// ─── Schemas ────────────────────────────────────────────────────────────────
import { SharedSpace, SharedSpaceSchema } from './schemas/shared-space.schema';
import { SharedSpaceMember, SharedSpaceMemberSchema } from './schemas/shared-space-member.schema';
import { SharedInvitation, SharedInvitationSchema } from './schemas/shared-invitation.schema';
import { SharedMovement, SharedMovementSchema } from './schemas/shared-movement.schema';
import { SharedMovementContribution, SharedMovementContributionSchema } from './schemas/shared-movement-contribution.schema';
import { SharedMovementSplit, SharedMovementSplitSchema } from './schemas/shared-movement-split.schema';
import { SharedSplitRule, SharedSplitRuleSchema } from './schemas/shared-split-rule.schema';
import { SharedCategory, SharedCategorySchema } from './schemas/shared-category.schema';
import { SharedAccountImpact, SharedAccountImpactSchema } from './schemas/shared-account-impact.schema';
import { SharedAuditLog, SharedAuditLogSchema } from './schemas/shared-audit-log.schema';
import { SharedAnalyticsSnapshot, SharedAnalyticsSnapshotSchema } from './schemas/shared-analytics-snapshot.schema';
import { SharedNotification, SharedNotificationSchema } from './schemas/shared-notification.schema';

// ─── External schemas needed by SharedAccountImpactService ───────────────────
import { Cuenta, CuentaSchema } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaSchema } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { CuentaHistorial, CuentaHistorialSchema } from '../cuenta-historial/schemas/cuenta-historial.schema';
import { SubcuentaHistorial, SubcuentaHistorialSchema } from '../subcuenta/schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import { User, UserSchema } from '../user/schemas/user.schema/user.schema';

// ─── External modules ────────────────────────────────────────────────────────
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { UtilsModule } from '../utils/utils.module';
import { EmailModule } from '../email/email.module';

// ─── Services ────────────────────────────────────────────────────────────────
import { SharedAuditService } from './services/shared-audit.service';
import { SharedNotificationsService } from './services/shared-notifications.service';
import { SharedSplitsService } from './services/shared-splits.service';
import { SharedMembersService } from './services/shared-members.service';
import { SharedCategoriesService } from './services/shared-categories.service';
import { SharedRulesService } from './services/shared-rules.service';
import { SharedSpacesService } from './services/shared-spaces.service';
import { SharedInvitationsService } from './services/shared-invitations.service';
import { SharedAccountImpactService } from './services/shared-account-impact.service';
import { SharedMovementsService } from './services/shared-movements.service';
import { SharedAnalyticsService } from './services/shared-analytics.service';

// ─── Controllers ─────────────────────────────────────────────────────────────
import { SharedSpacesController } from './controllers/shared-spaces.controller';
import { SharedInvitationsController } from './controllers/shared-invitations.controller';
import { SharedMovementsController } from './controllers/shared-movements.controller';
import { SharedRulesController } from './controllers/shared-rules.controller';
import { SharedCategoriesController } from './controllers/shared-categories.controller';
import { SharedAccountImpactController } from './controllers/shared-account-impact.controller';
import { SharedAnalyticsController } from './controllers/shared-analytics.controller';
import { SharedNotificationsController } from './controllers/shared-notifications.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      // Shared schemas
      { name: SharedSpace.name, schema: SharedSpaceSchema },
      { name: SharedSpaceMember.name, schema: SharedSpaceMemberSchema },
      { name: SharedInvitation.name, schema: SharedInvitationSchema },
      { name: SharedMovement.name, schema: SharedMovementSchema },
      { name: SharedMovementContribution.name, schema: SharedMovementContributionSchema },
      { name: SharedMovementSplit.name, schema: SharedMovementSplitSchema },
      { name: SharedSplitRule.name, schema: SharedSplitRuleSchema },
      { name: SharedCategory.name, schema: SharedCategorySchema },
      { name: SharedAccountImpact.name, schema: SharedAccountImpactSchema },
      { name: SharedAuditLog.name, schema: SharedAuditLogSchema },
      { name: SharedAnalyticsSnapshot.name, schema: SharedAnalyticsSnapshotSchema },
      { name: SharedNotification.name, schema: SharedNotificationSchema },
      // External schemas for bridge layer
      { name: Cuenta.name, schema: CuentaSchema },
      { name: Subcuenta.name, schema: SubcuentaSchema },
      { name: CuentaHistorial.name, schema: CuentaHistorialSchema },
      { name: SubcuentaHistorial.name, schema: SubcuentaHistorialSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificacionesModule,
    UtilsModule,
    EmailModule,
  ],
  controllers: [
    SharedSpacesController,
    SharedInvitationsController,
    SharedMovementsController,
    SharedRulesController,
    SharedCategoriesController,
    SharedAccountImpactController,
    SharedAnalyticsController,
    SharedNotificationsController,
  ],
  providers: [
    SharedAuditService,
    SharedNotificationsService,
    SharedSplitsService,
    SharedMembersService,
    SharedCategoriesService,
    SharedRulesService,
    SharedSpacesService,
    SharedInvitationsService,
    SharedAccountImpactService,
    SharedMovementsService,
    SharedAnalyticsService,
  ],
  exports: [
    SharedSpacesService,
    SharedMembersService,
    SharedMovementsService,
    SharedAnalyticsService,
    SharedNotificationsService,
    MongooseModule,
  ],
})
export class SharedModule {}
