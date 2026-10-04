import { Global, Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

/** Global so the order tracking page and the rating flow can reach it. */
@Global()
@Module({ controllers: [FeedbackController], providers: [FeedbackService], exports: [FeedbackService] })
export class FeedbackModule {}
