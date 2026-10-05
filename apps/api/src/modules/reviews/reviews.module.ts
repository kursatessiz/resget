import { Module } from '@nestjs/common';
import { AdminReviewsController, PublicReviewsController, ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

/** Public reviews (docs/YORUMLAR.md). */
@Module({
  controllers: [ReviewsController, PublicReviewsController, AdminReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
