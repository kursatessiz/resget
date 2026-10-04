import { Injectable, OnModuleInit } from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';
import { AttributionService } from './attribution.service';

/** Completed orders become first_order or repeat_order conversions (docs/ATIF.md); never holds up the order. */
@Injectable()
export class AttributionOrderHook implements OnModuleInit {
  constructor(
    private readonly orders: OrdersService,
    private readonly attribution: AttributionService,
  ) {}

  onModuleInit(): void {
    this.orders.addOrderListener((order) => this.attribution.onOrderEvent(order));
  }
}
