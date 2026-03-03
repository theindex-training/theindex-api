import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from './accounts/accounts.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AttendanceModule } from './attendance/attendance.module';
import { AuthModule } from './auth/auth.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { CashRegisterModule } from './cash-register/cash-register.module';
import { GymLocationsModule } from './gym-locations/gym-locations.module';
import { GymSubscriptionsModule } from './gym-subscriptions/gym-subscriptions.module';
import { PlansModule } from './plans/plans.module';
import { SettlementsModule } from './settlements/settlements.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { TraineeProfilesModule } from './trainee-profiles/trainee-profiles.module';
import { TrainingTimesModule } from './training-times/training-times.module';
import { TrainerProfilesModule } from './trainer-profiles/trainer-profiles.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // process.env available everywhere
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return {
          type: 'postgres' as const,
          host: config.get<string>('DB_HOST'),
          port: Number(config.get<string>('DB_PORT') || 5432),
          username: config.get<string>('DB_USER'),
          password: config.get<string>('DB_PASS'),
          database: config.get<string>('DB_NAME'),
          autoLoadEntities: true,
          synchronize: config.get<string>('DB_SYNC') === 'true',
        };
      },
    }),

    BootstrapModule,
    CashRegisterModule,
    AuthModule,
    AccountsModule,
    TrainerProfilesModule,
    TraineeProfilesModule,
    PlansModule,
    GymLocationsModule,
    GymSubscriptionsModule,
    SubscriptionsModule,
    AttendanceModule,
    TrainingTimesModule,
    SettlementsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
