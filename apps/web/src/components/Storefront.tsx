'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ALLERGENS,
  GROUP_KEY_HEADER,
  LOW_STOCK_THRESHOLD,
  avoidsAllergens,
  categoryServedAt,
  localClock,
  CHECKOUT_CONSENT_CHANNELS,
  couponDiscountMinor,
  customerDeliveryFee,
  pointsEarnedFor,
  redeemableFor,
  formatMoney,
} from '@resget/shared';
import type { Allergen, OrderSource } from '@resget/shared';
import type {
  CheckoutConsentChannel,
  CustomerAddressDTO,
  StorefrontViewerDTO,
  FulfillmentTypeValue,
  GroupCartDTO,
  GroupCartLineDTO,
  MenuModifierGroupDTO,
  OrderLineInput,
  PublicCouponDTO,
  PublicOrderResultDTO,
  StorefrontCategoryDTO,
  StorefrontDTO,
  StorefrontItemDTO,
} from '@resget/shared';
import { Badge, Button, Card, TextAreaField, TextField, SelectField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { useT } from '@/lib/use-t';

interface CartLine {
  key: string;
  item: StorefrontItemDTO;
  quantity: number;
  modifiers: { id?: string; name: string; priceDeltaMinor: number }[];
}

/**
 * A shared basket (docs/GRUP_SIPARISI.md): this browser's lines are saved to
 * the basket as they change; only the host sees the checkout, with
 * everyone's lines in the total.
 */
export interface GroupMode {
  token: string;
  key: string;
  participantId: string;
  isHost: boolean;
  /** Locked or placed: this browser's lines can no longer change. */
  closed: boolean;
  /** This browser's lines as the basket last had them, used once to fill the cart. */
  initialLines: GroupCartLineDTO[];
  /** Everyone else's subtotal and lines from the last refresh. */
  othersSubtotalMinor: number;
  othersLines: OrderLineInput[];
  onSaved: (cart: GroupCartDTO) => void;
}

type PaymentChoice =
  | { method: 'TAB' }
  | { method: 'CASH_ON_DELIVERY' | 'CARD_ON_DELIVERY' | 'ONLINE_CARD'; savedPaymentMethodId?: string }
  | { method: 'MEAL_CARD'; providerCode: string; atDoor: boolean };

/**
 * Menu, basket and checkout on one page (docs/VITRIN.md). Prices and totals
 * shown here are previews; the API computes the order from its own data.
 */
export function Storefront({
  storefront,
  locale,
  source,
  viewer = null,
  initialCouponCode = null,
  group = null,
}: {
  storefront: StorefrontDTO;
  locale: string;
  /** Where the page was opened from: the table QR (token) or the restaurant page (slug). */
  source: { kind: 'qr'; token: string } | { kind: 'site'; via?: OrderSource | null };
  /** The signed-in customer, when there is one: name, phone and saved addresses prefill the form. */
  viewer?: StorefrontViewerDTO | null;
  /** A code from a shared invite link (?kod=, docs/TAVSIYE.md); it only fills the coupon field. */
  initialCouponCode?: string | null;
  /** Group order mode (docs/GRUP_SIPARISI.md). */
  group?: GroupMode | null;
}) {
  const t = useT(locale);
  const router = useRouter();
  const { restaurant, table, payment, ordering } = storefront;
  const [cart, setCart] = useState<CartLine[]>(() => {
    if (!group) return [];
    const items = new Map(storefront.categories.flatMap((c) => c.items).map((i) => [i.id, i]));
    return group.initialLines.flatMap((line) => {
      const item = items.get(line.menuItemId);
      if (!item) return [];
      return [
        {
          key: `${item.id}:${line.modifiers.map((m) => m.name).join('|')}`,
          item,
          quantity: line.quantity,
          modifiers: line.modifiers,
        },
      ];
    });
  });
  // Group mode: this browser's lines go to the shared basket shortly after each change.
  const groupSave = useRef<Promise<void> | null>(null);
  const groupDirty = useRef(false);
  const saveGroupLines = useCallback(
    (lines: CartLine[]) => {
      if (!group || group.closed) return Promise.resolve();
      groupDirty.current = false;
      const run = bffJson<GroupCartDTO>(`public/group-carts/${group.token}/participants/${group.participantId}/lines`, {
        method: 'PUT',
        headers: { [GROUP_KEY_HEADER]: group.key },
        body: JSON.stringify({
          lines: lines.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity, modifiers: l.modifiers })),
        }),
      }).then(group.onSaved);
      groupSave.current = run;
      return run;
    },
    [group],
  );
  const firstCart = useRef(true);
  useEffect(() => {
    if (firstCart.current) {
      firstCart.current = false;
      return undefined;
    }
    if (!group || group.closed) return undefined;
    groupDirty.current = true;
    const timer = setTimeout(() => {
      saveGroupLines(cart).catch((err: unknown) =>
        setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
      );
    }, 400);
    return () => clearTimeout(timer);
    // The cart is the only trigger; group and the saver are stable for a mounted page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);
  const [picking, setPicking] = useState<{ item: StorefrontItemDTO; chosen: Record<string, string[]> } | null>(null);
  const [fulfillment, setFulfillment] = useState<FulfillmentTypeValue>(
    ordering.dineIn ? 'DINE_IN' : ordering.delivery ? 'DELIVERY' : 'PICKUP',
  );
  const defaultAddress = viewer?.addresses.find((a) => a.isDefault) ?? viewer?.addresses[0] ?? null;
  const [fullName, setFullName] = useState(viewer?.fullName ?? '');
  const [phone, setPhone] = useState(viewer?.phone ?? '');
  const [addressLine, setAddressLine] = useState(defaultAddress?.addressLine ?? '');
  const [city, setCity] = useState(defaultAddress?.city ?? '');
  const [district, setDistrict] = useState(defaultAddress?.district ?? '');
  const [addressNote, setAddressNote] = useState(defaultAddress?.note ?? '');
  const [savedAddressId, setSavedAddressId] = useState<string>(defaultAddress?.id ?? '');
  const [saveAddress, setSaveAddress] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [note, setNote] = useState('');
  // Allergens (docs/ALERJENLER.md): the guest can hide items that contain what they avoid.
  const [avoid, setAvoid] = useState<Allergen[]>([]);
  const menuAllergens = ALLERGENS.filter((a) =>
    storefront.categories.some((c) => c.items.some((item) => item.allergens.includes(a))),
  );
  const hasTags = storefront.categories.some((c) =>
    c.items.some((item) => item.allergens.length > 0 || item.dietaryTags.length > 0),
  );
  // Scheduled orders (docs/ILERI_TARIHLI_SIPARIS.md): a later slot instead of as soon as possible.
  const scheduling = storefront.scheduling;
  const [when, setWhen] = useState<'NOW' | 'LATER'>(scheduling && !storefront.availability.accepting ? 'LATER' : 'NOW');
  const [slot, setSlot] = useState('');
  const scheduled = scheduling !== null && fulfillment !== 'DINE_IN' && when === 'LATER' && slot !== '';
  const slotDay = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: scheduling?.timezone,
    }).format(new Date(iso));
  const slotTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: scheduling?.timezone }).format(
      new Date(iso),
    );
  const slotDays = (scheduling?.slots ?? []).reduce<Array<{ day: string; slots: string[] }>>((days, iso) => {
    const day = slotDay(iso);
    const last = days[days.length - 1];
    if (last && last.day === day) last.slots.push(iso);
    else days.push({ day, slots: [iso] });
    return days;
  }, []);
  // Menu dayparts (docs/OGUN_SAATLERI.md): a category is ordered only inside its windows, at the time the order is for.
  const orderTime = scheduled ? new Date(slot) : new Date();
  const zoneOfMenu = storefront.availability.timezone;
  const served = (category: StorefrontCategoryDTO) => categoryServedAt(category.availableHours, orderTime, zoneOfMenu);
  const categoryOfItem = new Map(
    storefront.categories.flatMap((category) => category.items.map((item) => [item.id, category] as const)),
  );
  const todaysWindows = (category: StorefrontCategoryDTO) =>
    (category.availableHours?.[localClock(orderTime, zoneOfMenu).day] ?? []).map(([a, b]) => `${a} - ${b}`).join(', ');
  const unservedInCart = cart.filter((line) => {
    const category = categoryOfItem.get(line.item.id);
    return category ? !served(category) : false;
  });
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [marketingChannels, setMarketingChannels] = useState<CheckoutConsentChannel[]>([]);
  const [usePoints, setUsePoints] = useState(false);
  const [couponText, setCouponText] = useState(initialCouponCode ?? '');
  const [coupon, setCoupon] = useState<PublicCouponDTO | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [startedSent, setStartedSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const paymentChoices = useMemo<{ id: string; label: string; choice: PaymentChoice }[]>(() => {
    const list: { id: string; label: string; choice: PaymentChoice }[] = [];
    // A table order can go on the table's open tab instead of being paid now (docs/ACIK_HESAP.md).
    if (storefront.tab?.enabled && fulfillment === 'DINE_IN')
      list.push({ id: 'tab', label: t('tab.payment.option'), choice: { method: 'TAB' } });
    if (payment.cashOnDelivery)
      list.push({ id: 'cash', label: t('payments.method.CASH_ON_DELIVERY'), choice: { method: 'CASH_ON_DELIVERY' } });
    if (payment.cardOnDelivery)
      list.push({
        id: 'card-door',
        label: t('payments.method.CARD_ON_DELIVERY'),
        choice: { method: 'CARD_ON_DELIVERY' },
      });
    if (payment.onlineCard) {
      // The signed-in customer's wallet cards this restaurant takes come first (docs/CUZDAN.md).
      for (const card of viewer?.walletCards ?? []) {
        const wallet = payment.wallets.find((w) => w.code === card.provider);
        if (!wallet) continue;
        list.push({
          id: `wallet-${card.id}`,
          label: t('wallets.payWith', { wallet: wallet.name, brand: card.brand, last4: card.last4 }),
          choice: { method: 'ONLINE_CARD', savedPaymentMethodId: card.id },
        });
      }
      list.push({ id: 'online', label: t('payments.method.ONLINE_CARD'), choice: { method: 'ONLINE_CARD' } });
    }
    for (const card of payment.mealCardsOnline) {
      list.push({
        id: `mc-online-${card.providerCode}`,
        label: t('shop.payment.mealCardOnline', { card: card.name }),
        choice: { method: 'MEAL_CARD', providerCode: card.providerCode, atDoor: false },
      });
    }
    for (const card of payment.mealCardsOnDelivery) {
      list.push({
        id: `mc-door-${card.providerCode}`,
        label: t('shop.payment.mealCardAtDoor', { card: card.name }),
        choice: { method: 'MEAL_CARD', providerCode: card.providerCode, atDoor: true },
      });
    }
    return list;
  }, [payment, t, storefront.tab, fulfillment, viewer]);
  const [paymentId, setPaymentId] = useState<string>('');
  const selectedPayment = paymentChoices.find((p) => p.id === paymentId) ?? paymentChoices[0] ?? null;

  const money = (minor: number) => formatMoney({ amountMinor: minor, currency: restaurant.currency }, locale);
  const ownSubtotal = cart.reduce(
    (sum, line) =>
      sum + (line.item.priceMinor + line.modifiers.reduce((m, x) => m + x.priceDeltaMinor, 0)) * line.quantity,
    0,
  );
  // In a group the host pays for everyone's lines.
  const subtotal = ownSubtotal + (group?.othersSubtotalMinor ?? 0);
  const hasLines = cart.length > 0 || (group?.othersLines.length ?? 0) > 0;
  const showCheckout = group ? group.isHost && hasLines : cart.length > 0;
  const previewFee =
    fulfillment === 'DELIVERY' && !ordering.quotedDelivery && ordering.deliveryFeePolicy
      ? customerDeliveryFee(0, subtotal, ordering.deliveryFeePolicy)
      : 0;
  // Loyalty (docs/SADAKAT.md): the preview mirrors the API's arithmetic; the API decides the final figures.
  const loyalty = storefront.loyalty;
  const points = viewer?.loyaltyPoints ?? null;
  const redemption =
    loyalty && points !== null ? redeemableFor(loyalty, points, subtotal) : { points: 0, discountMinor: 0 };
  const pointsDiscount = !coupon && usePoints && redemption.points > 0 ? redemption.discountMinor : 0;
  // Coupon (docs/KUPONLAR.md): a preview with the shared arithmetic; never combined with points.
  const couponDiscount = coupon && subtotal >= coupon.minBasketMinor ? couponDiscountMinor(coupon, subtotal) : 0;
  const discount = pointsDiscount + couponDiscount;
  const pointsToEarn = loyalty ? pointsEarnedFor(loyalty, subtotal - discount) : 0;

  const applyCoupon = async () => {
    setCouponError(null);
    try {
      const found = await bffJson<PublicCouponDTO>(
        `public/restaurants/${restaurant.slug}/coupons/${encodeURIComponent(couponText.trim().toUpperCase())}`,
      );
      setCoupon(found);
      setUsePoints(false);
    } catch (err) {
      setCoupon(null);
      setCouponError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    }
  };

  const noteStarted = () => {
    if (startedSent || source.kind !== 'qr') return;
    setStartedSent(true);
    bffJson<void>(`public/qr/${source.token}/funnel`, {
      method: 'POST',
      body: JSON.stringify({ outcome: 'STARTED_ORDER' }),
    }).catch(() => undefined);
  };

  const addLine = (item: StorefrontItemDTO, modifiers: CartLine['modifiers']) => {
    const key = `${item.id}:${modifiers.map((m) => m.name).join('|')}`;
    setCart((lines) => {
      const existing = lines.find((l) => l.key === key);
      if (existing) return lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...lines, { key, item, quantity: 1, modifiers }];
    });
    noteStarted();
  };

  const startAdd = (item: StorefrontItemDTO) => {
    if (item.modifierGroups.length === 0) {
      addLine(item, []);
      return;
    }
    setPicking({ item, chosen: Object.fromEntries(item.modifierGroups.map((g) => [g.id, []])) });
  };

  const confirmPick = () => {
    if (!picking) return;
    const modifiers: CartLine['modifiers'] = [];
    for (const group of picking.item.modifierGroups) {
      const chosen = picking.chosen[group.id] ?? [];
      if (chosen.length < group.minSelect || chosen.length > group.maxSelect) {
        setError(t('shop.cart.optionsRequired'));
        return;
      }
      for (const id of chosen) {
        const modifier = group.modifiers.find((m) => m.id === id);
        if (modifier)
          modifiers.push({
            id: modifier.id,
            name: `${group.name}: ${modifier.name}`,
            priceDeltaMinor: modifier.priceDeltaMinor,
          });
      }
    }
    setError(null);
    addLine(picking.item, modifiers);
    setPicking(null);
  };

  const toggleChoice = (group: MenuModifierGroupDTO, id: string) =>
    setPicking((p) => {
      if (!p) return p;
      const current = p.chosen[group.id] ?? [];
      let next: string[];
      if (group.maxSelect === 1) next = current.includes(id) ? [] : [id];
      else if (current.includes(id)) next = current.filter((x) => x !== id);
      else next = current.length < group.maxSelect ? [...current, id] : current;
      return { ...p, chosen: { ...p.chosen, [group.id]: next } };
    });

  const changeQuantity = (key: string, delta: number) =>
    setCart((lines) =>
      lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0),
    );

  const submit = async () => {
    if (!hasLines || !selectedPayment) return;
    setBusy(true);
    setError(null);
    try {
      // The host's own last change reaches the basket before the order is placed from it.
      if (group && groupDirty.current) await saveGroupLines(cart);
      else if (groupSave.current) await groupSave.current;
      const items: OrderLineInput[] = [
        ...cart.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity, modifiers: l.modifiers })),
        ...(group?.othersLines ?? []),
      ];
      const contact =
        fulfillment === 'DINE_IN' && !phone.trim() ? undefined : { fullName: fullName.trim(), phone: phone.trim() };
      const body = {
        fulfillment,
        items,
        ...(contact ? { customer: contact } : {}),
        ...(contact && !storefront.consentV2 && marketingOptIn ? { marketingOptIn: true } : {}),
        ...(contact && storefront.consentV2 && marketingChannels.length > 0 ? { marketingChannels } : {}),
        ...(pointsDiscount > 0 ? { useLoyaltyPoints: true } : {}),
        ...(coupon ? { couponCode: coupon.code } : {}),
        ...(fulfillment === 'DELIVERY'
          ? {
              address: {
                addressLine: addressLine.trim(),
                city: city.trim(),
                district: district.trim(),
                ...(addressNote.trim() ? { note: addressNote.trim() } : {}),
                contactName: fullName.trim(),
                contactPhone: phone.trim(),
                point: viewer?.addresses.find((a) => a.id === savedAddressId)?.point ?? null,
              },
            }
          : {}),
        ...(selectedPayment.choice.method === 'TAB' ? { tab: true } : { payment: selectedPayment.choice }),
        ...(scheduled ? { scheduledFor: slot } : {}),
        // The channel link the page was opened from (docs/SIPARIS_BAGLANTILARI.md).
        ...(source.kind === 'site' && source.via ? { source: source.via } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        returnUrl: `${window.location.origin}/t/`,
      };
      const path = group
        ? `public/group-carts/${group.token}/orders`
        : source.kind === 'qr'
          ? `public/qr/${source.token}/orders`
          : `public/restaurants/${restaurant.slug}/orders`;
      if (viewer && fulfillment === 'DELIVERY' && !savedAddressId && saveAddress && saveLabel.trim()) {
        // The address joins the account first; a failure here must not block the order itself.
        await bffJson<CustomerAddressDTO[]>('me/addresses', {
          method: 'POST',
          body: JSON.stringify({
            label: saveLabel.trim(),
            addressLine: addressLine.trim(),
            city: city.trim(),
            district: district.trim(),
            ...(addressNote.trim() ? { note: addressNote.trim() } : {}),
          }),
        }).catch(() => undefined);
      }
      const result = await bffJson<PublicOrderResultDTO>(path, {
        method: 'POST',
        body: JSON.stringify(body),
        ...(group ? { headers: { [GROUP_KEY_HEADER]: group.key } } : {}),
      });
      if (result.checkoutUrl) {
        setDone(t('shop.redirectingToPayment'));
        window.location.assign(result.checkoutUrl);
        return;
      }
      setDone(t('shop.placed'));
      // A tab order leads to the table's bill, which follows every order on it.
      const tabToken = result.tabUrl?.split('/hesap/')[1];
      router.push(tabToken ? `/hesap/${tabToken}` : `/t/${result.trackingToken}`);
    } catch (err) {
      setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network'));
    } finally {
      setBusy(false);
    }
  };

  const needsContact = fulfillment !== 'DINE_IN';
  const { availability } = storefront;
  const clock = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: availability.timezone,
        }).format(new Date(iso))
      : '';
  const availabilityNote =
    availability.state === 'PAUSED'
      ? t('shop.availability.paused', { time: clock(availability.pausedUntil) })
      : availability.state === 'CLOSED'
        ? availability.nextOpenAt
          ? t('shop.availability.closed', { time: clock(availability.nextOpenAt) })
          : t('shop.availability.closedNoTime')
        : availability.busyExtraMinutes > 0
          ? t('shop.availability.busy', { minutes: ordering.defaultPrepMinutes + availability.busyExtraMinutes })
          : null;
  // Delivery zone (docs/VITRIN.md): the minimum is checked here too; the radius only the API can check.
  const zone = ordering.deliveryZone;
  const belowMinimum =
    fulfillment === 'DELIVERY' && zone !== null && zone.minBasketMinor > 0 && subtotal < zone.minBasketMinor;
  const canSchedule = scheduling !== null && fulfillment !== 'DINE_IN';
  const canSubmit =
    (canSchedule && when === 'LATER' ? slot !== '' : availability.accepting) &&
    !belowMinimum &&
    unservedInCart.length === 0 &&
    hasLines &&
    selectedPayment !== null &&
    (!needsContact || (fullName.trim().length > 0 && phone.trim().length > 0)) &&
    (fulfillment !== 'DELIVERY' || (addressLine.trim().length >= 5 && city.trim() && district.trim()));

  return (
    <div className="flex flex-col gap-8">
      {availabilityNote && (
        <p role="status" className="ui-heading" data-availability={availability.state}>
          {availabilityNote}
        </p>
      )}
      {storefront.tab?.open && (
        <p className="flex flex-wrap items-center gap-2" data-open-tab>
          <span>
            {t('tab.banner', {
              total: money(storefront.tab.open.totalMinor),
              due: money(storefront.tab.open.dueMinor),
            })}
          </span>
          <Link href={`/hesap/${storefront.tab.open.token}`} className="pui-btn pui-link pui-theme">
            {t('tab.banner.link')}
          </Link>
        </p>
      )}
      {hasTags && (
        <section className="flex flex-col gap-2" aria-label={t('allergens.filter.title')} data-allergen-filter>
          {menuAllergens.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="ui-label">{t('allergens.filter.title')}</legend>
              <div className="flex flex-wrap gap-3">
                {menuAllergens.map((allergen) => (
                  <label key={allergen} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="pui-checkbox"
                      checked={avoid.includes(allergen)}
                      onChange={(e) =>
                        setAvoid((current) =>
                          e.target.checked ? [...current, allergen] : current.filter((a) => a !== allergen),
                        )
                      }
                    />
                    <span>{t(`allergens.name.${allergen}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <p className="ui-caption">{t('allergens.filter.disclaimer')}</p>
        </section>
      )}
      {storefront.categories.map((category) => (
        <section key={category.id} className="flex flex-col gap-3" aria-label={category.name}>
          <h2 className="ui-heading">{category.name}</h2>
          {!served(category) && (
            <p className="ui-caption" data-daypart-closed>
              {todaysWindows(category)
                ? t('dayparts.servedOnly', { hours: todaysWindows(category) })
                : t('dayparts.notToday')}
            </p>
          )}
          <ul className="ui-divide">
            {category.items.length === 0 && <li className="ui-caption py-2">{t('menu.emptyCategory')}</li>}
            {category.items.length > 0 && category.items.every((item) => !avoidsAllergens(item, avoid)) && (
              <li className="ui-caption py-2">{t('allergens.filter.allHidden')}</li>
            )}
            {category.items
              .filter((item) => avoidsAllergens(item, avoid))
              .map((item) => (
                <li key={item.id} className="flex flex-col gap-2 py-3" data-menu-item={item.name}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1">
                      <span className={item.isAvailable ? undefined : 'ui-text-muted'}>{item.name}</span>
                      {item.description && <span className="ui-caption">{item.description}</span>}
                      {item.dietaryTags.length > 0 && (
                        <span className="flex flex-wrap gap-1" data-dietary-tags>
                          {item.dietaryTags.map((tag) => (
                            <Badge key={tag} tone="success">
                              {t(`allergens.diet.${tag}`)}
                            </Badge>
                          ))}
                        </span>
                      )}
                      {item.allergens.length > 0 && (
                        <span className="ui-caption" data-allergens>
                          {t('allergens.contains', {
                            list: item.allergens.map((a) => t(`allergens.name.${a}`)).join(', '),
                          })}
                        </span>
                      )}
                      {!item.isAvailable && <Badge tone="muted">{t('shop.unavailable')}</Badge>}
                      {item.isAvailable && item.stockLeft !== null && item.stockLeft <= LOW_STOCK_THRESHOLD && (
                        <Badge tone="warn" data-stock-left={item.stockLeft}>
                          {t('stock.shop.left', { count: item.stockLeft })}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="ui-price">{money(item.priceMinor)}</span>
                      {item.isAvailable && served(category) && (
                        <Button
                          variant="soft"
                          onClick={() => startAdd(item)}
                          disabled={group?.closed}
                          aria-label={`${t('shop.cart.add')}: ${item.name}`}
                        >
                          {t('shop.cart.add')}
                        </Button>
                      )}
                    </div>
                  </div>
                  {picking?.item.id === item.id && (
                    <div className="flex flex-col gap-3" role="group" aria-label={t('shop.cart.options')}>
                      {picking.item.modifierGroups.map((group) => (
                        <fieldset key={group.id} className="flex flex-col gap-1">
                          <legend className="ui-caption">
                            {group.name}{' '}
                            {group.minSelect > 0 ? t('shop.cart.chooseAtLeast', { count: group.minSelect }) : ''}{' '}
                            {group.maxSelect > 1 ? t('shop.cart.chooseUpTo', { count: group.maxSelect }) : ''}
                          </legend>
                          {group.modifiers.map((modifier) => (
                            <label key={modifier.id} className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2">
                                <input
                                  type={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                                  className={group.maxSelect === 1 ? 'pui-radio' : 'pui-checkbox'}
                                  name={`group-${group.id}`}
                                  checked={(picking.chosen[group.id] ?? []).includes(modifier.id)}
                                  onChange={() => toggleChoice(group, modifier.id)}
                                />
                                <span>{modifier.name}</span>
                              </span>
                              {modifier.priceDeltaMinor !== 0 && (
                                <span className="ui-caption">{money(modifier.priceDeltaMinor)}</span>
                              )}
                            </label>
                          ))}
                        </fieldset>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={confirmPick}>{t('shop.cart.add')}</Button>
                        <Button variant="outline" tone="muted" onClick={() => setPicking(null)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}

      <Card
        title={group ? t('group.yourLines') : t('shop.cart.title')}
        aria-label={group ? t('group.yourLines') : t('shop.cart.title')}
      >
        {cart.length === 0 ? (
          <p className="ui-text-muted">{t('shop.cart.empty')}</p>
        ) : (
          <ul className="ui-divide">
            {cart.map((line) => (
              <li key={line.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex flex-col">
                  <span>{line.item.name}</span>
                  {line.modifiers.length > 0 && (
                    <span className="ui-caption">{line.modifiers.map((m) => m.name).join(', ')}</span>
                  )}
                  {unservedInCart.includes(line) && (
                    <span className="ui-caption" data-daypart-cart>
                      {t('dayparts.notAtThisTime')}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    tone="muted"
                    onClick={() => changeQuantity(line.key, -1)}
                    disabled={group?.closed}
                    aria-label={`${t('shop.cart.remove')}: ${line.item.name}`}
                  >
                    -
                  </Button>
                  <span aria-label={t('shop.cart.quantity')}>{line.quantity}</span>
                  <Button
                    variant="outline"
                    tone="muted"
                    onClick={() => changeQuantity(line.key, 1)}
                    disabled={group?.closed}
                    aria-label={`${t('shop.cart.add')}: ${line.item.name}`}
                  >
                    +
                  </Button>
                  <span className="ui-price">
                    {money(
                      (line.item.priceMinor + line.modifiers.reduce((m, x) => m + x.priceDeltaMinor, 0)) *
                        line.quantity,
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {hasLines && (
          <dl className="flex flex-col gap-1">
            <div className="flex justify-between">
              <dt className="ui-text-muted">{group ? t('group.groupSubtotal') : t('shop.cart.subtotal')}</dt>
              <dd>{money(subtotal)}</dd>
            </div>
            {fulfillment === 'DELIVERY' && (
              <div className="flex justify-between">
                <dt className="ui-text-muted">{t('shop.cart.deliveryFee')}</dt>
                <dd>
                  {ordering.quotedDelivery
                    ? t('shop.cart.deliveryFeeQuoted')
                    : previewFee === 0
                      ? t('shop.cart.deliveryFree')
                      : money(previewFee)}
                </dd>
              </div>
            )}
            {pointsDiscount > 0 && (
              <div className="flex justify-between">
                <dt className="ui-text-muted">{t('loyalty.shop.discount')}</dt>
                <dd>-{money(pointsDiscount)}</dd>
              </div>
            )}
            {couponDiscount > 0 && coupon && (
              <div className="flex justify-between" data-coupon-line>
                <dt className="ui-text-muted">{t('shop.coupon.line', { code: coupon.code })}</dt>
                <dd>-{money(couponDiscount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="ui-heading">{t('shop.cart.total')}</dt>
              <dd className="ui-price">{money(subtotal + previewFee - discount)}</dd>
            </div>
          </dl>
        )}
        {hasLines && ordering.coupons && (
          <div className="flex flex-col gap-2" data-coupon>
            {coupon ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="success">{t('shop.coupon.applied', { code: coupon.code })}</Badge>
                <Button variant="link" onClick={() => setCoupon(null)}>
                  {t('shop.coupon.remove')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <TextField
                  id="sf-coupon"
                  label={t('shop.coupon.label')}
                  value={couponText}
                  maxLength={24}
                  onChange={(e) => setCouponText(e.target.value)}
                />
                <Button variant="soft" onClick={() => void applyCoupon()} disabled={couponText.trim().length < 3}>
                  {t('shop.coupon.apply')}
                </Button>
              </div>
            )}
            {!coupon && initialCouponCode && couponText === initialCouponCode && (
              <p className="ui-caption">{t('referrals.shop.prefilled')}</p>
            )}
            {coupon && subtotal < coupon.minBasketMinor && (
              <p className="ui-caption">{t('shop.coupon.minimum', { amount: money(coupon.minBasketMinor) })}</p>
            )}
            {coupon?.firstOrderOnly && <p className="ui-caption">{t('shop.coupon.firstOrder')}</p>}
            {coupon && redemption.points > 0 && <p className="ui-caption">{t('shop.coupon.withPoints')}</p>}
            {couponError && (
              <p role="alert" className="ui-caption">
                {couponError}
              </p>
            )}
          </div>
        )}
        {hasLines && loyalty && (
          <div className="flex flex-col gap-2" data-loyalty>
            {points === null && <p className="ui-caption">{t('loyalty.shop.signInHint')}</p>}
            {points !== null && <p className="ui-caption">{t('loyalty.shop.balance', { points })}</p>}
            {points !== null && redemption.points > 0 && !coupon && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="pui-checkbox"
                  checked={usePoints}
                  onChange={(e) => setUsePoints(e.target.checked)}
                />
                <span>
                  {t('loyalty.shop.use', { points: redemption.points, amount: money(redemption.discountMinor) })}
                </span>
              </label>
            )}
            {points !== null && points > 0 && redemption.points === 0 && (
              <p className="ui-caption">
                {t('loyalty.shop.notEnough', { points: loyalty.redeemPoints, minOrder: money(loyalty.minOrderMinor) })}
              </p>
            )}
            <p className="ui-caption">
              {t('loyalty.shop.earnHint', {
                points: pointsToEarn,
                step: money(loyalty.earnStepMinor),
                earn: loyalty.earnPoints,
              })}
            </p>
          </div>
        )}
      </Card>

      {showCheckout && (
        <form
          className="flex flex-col gap-6"
          aria-label={t('shop.submit')}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="ui-heading">{t('shop.fulfillment.title')}</legend>
            {(['DINE_IN', 'PICKUP', 'DELIVERY'] as const)
              .filter((f) =>
                f === 'DINE_IN' ? ordering.dineIn : f === 'DELIVERY' ? ordering.delivery : ordering.pickup,
              )
              .map((f) => (
                <label key={f} className="flex items-center gap-2">
                  <input
                    type="radio"
                    className="pui-radio"
                    name="fulfillment"
                    value={f}
                    checked={fulfillment === f}
                    onChange={() => setFulfillment(f)}
                  />
                  <span>
                    {f === 'DINE_IN'
                      ? t('shop.fulfillment.DINE_IN', { label: table?.label ?? '' })
                      : t(`shop.fulfillment.${f}`)}
                  </span>
                </label>
              ))}
          </fieldset>

          {canSchedule && scheduling && (
            <fieldset className="flex flex-col gap-2" data-scheduling>
              <legend className="ui-heading">{t('shop.when.title')}</legend>
              {!availability.accepting && <p className="ui-text-muted">{t('shop.when.preorderNote')}</p>}
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  className="pui-radio"
                  name="when"
                  value="NOW"
                  checked={when === 'NOW'}
                  disabled={!availability.accepting}
                  onChange={() => setWhen('NOW')}
                />
                <span>{t('shop.when.now')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  className="pui-radio"
                  name="when"
                  value="LATER"
                  checked={when === 'LATER'}
                  onChange={() => setWhen('LATER')}
                />
                <span>{t('shop.when.later')}</span>
              </label>
              {when === 'LATER' &&
                (scheduling.slots.length === 0 ? (
                  <p className="ui-caption">{t('shop.when.noSlots')}</p>
                ) : (
                  <SelectField
                    id="sf-slot"
                    label={t('shop.when.slot')}
                    help={fulfillment === 'DELIVERY' ? t('shop.when.deliveryHelp') : t('shop.when.pickupHelp')}
                    value={slot}
                    onChange={(e) => setSlot(e.target.value)}
                  >
                    <option value="">{t('shop.when.pickSlot')}</option>
                    {slotDays.map((group) => (
                      <optgroup key={group.day} label={group.day}>
                        {group.slots.map((iso) => (
                          <option key={iso} value={iso}>
                            {slotTime(iso)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </SelectField>
                ))}
            </fieldset>
          )}

          <fieldset className="grid gap-3 md:grid-cols-2">
            <legend className="ui-heading">{t('shop.customer.title')}</legend>
            <TextField
              id="sf-name"
              label={t('shop.customer.name')}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              required={needsContact}
            />
            <TextField
              id="sf-phone"
              label={t('shop.customer.phone')}
              help={t('shop.customer.phoneHelp')}
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              required={needsContact}
            />
            {storefront.consentV2 ? (
              // One unticked box per channel (docs/RIZA.md): consent is specific, never bundled.
              <div className="flex flex-col gap-2 md:col-span-2" role="group" aria-label={t('consent.checkout.title')}>
                <span className="ui-caption">{t('consent.checkout.title')}</span>
                {CHECKOUT_CONSENT_CHANNELS.map((channel) => (
                  <label key={channel} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="pui-checkbox"
                      checked={marketingChannels.includes(channel)}
                      onChange={(e) =>
                        setMarketingChannels((current) =>
                          e.target.checked ? [...current, channel] : current.filter((c) => c !== channel),
                        )
                      }
                    />
                    <span className="ui-caption">{t(`consent.checkout.${channel}`)}</span>
                  </label>
                ))}
              </div>
            ) : (
              <label className="flex items-start gap-2 md:col-span-2">
                <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />
                <span className="ui-caption">{t('shop.customer.marketingOptIn')}</span>
              </label>
            )}
          </fieldset>

          {fulfillment === 'DELIVERY' && (
            <fieldset className="grid gap-3 md:grid-cols-2">
              <legend className="ui-heading">{t('shop.address.title')}</legend>
              {zone && (
                <p className="ui-caption md:col-span-2" data-delivery-zone>
                  {t('shop.zone.radius', {
                    km: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(zone.radiusMeters / 1000),
                  })}
                  {zone.minBasketMinor > 0 && ` ${t('shop.zone.minimum', { amount: money(zone.minBasketMinor) })}`}
                </p>
              )}
              {viewer && viewer.addresses.length > 0 && (
                <SelectField
                  id="sf-saved-address"
                  label={t('account.shop.savedAddress')}
                  className="md:col-span-2"
                  value={savedAddressId}
                  onChange={(e) => {
                    const chosen = viewer.addresses.find((a) => a.id === e.target.value) ?? null;
                    setSavedAddressId(chosen?.id ?? '');
                    setAddressLine(chosen?.addressLine ?? '');
                    setCity(chosen?.city ?? '');
                    setDistrict(chosen?.district ?? '');
                    setAddressNote(chosen?.note ?? '');
                  }}
                >
                  <option value="">{t('account.shop.newAddress')}</option>
                  {viewer.addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}: {a.addressLine}
                    </option>
                  ))}
                </SelectField>
              )}
              <TextField
                id="sf-address"
                label={t('shop.address.line')}
                value={addressLine}
                onChange={(e) => setAddressLine(e.target.value)}
                autoComplete="street-address"
                required
                className="md:col-span-2"
              />
              <TextField
                id="sf-city"
                label={t('shop.address.city')}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
              />
              <TextField
                id="sf-district"
                label={t('shop.address.district')}
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                required
              />
              <TextField
                id="sf-address-note"
                label={t('shop.address.note')}
                value={addressNote}
                onChange={(e) => setAddressNote(e.target.value)}
                className="md:col-span-2"
              />
              {viewer && !savedAddressId && (
                <>
                  <label className="flex items-center gap-2 md:col-span-2">
                    <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />
                    <span className="ui-caption">{t('account.shop.saveAddress')}</span>
                  </label>
                  {saveAddress && (
                    <TextField
                      id="sf-save-label"
                      label={t('account.shop.saveAddressLabel')}
                      value={saveLabel}
                      onChange={(e) => setSaveLabel(e.target.value)}
                      maxLength={40}
                    />
                  )}
                </>
              )}
            </fieldset>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="ui-heading">{t('shop.payment.title')}</legend>
            {paymentChoices.length === 0 && <p className="ui-text-muted">{t('shop.payment.none')}</p>}
            {paymentChoices.map((option) => (
              <label key={option.id} className="flex items-center gap-2">
                <input
                  type="radio"
                  className="pui-radio"
                  name="payment"
                  value={option.id}
                  checked={(selectedPayment?.id ?? '') === option.id}
                  onChange={() => setPaymentId(option.id)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>

          <TextAreaField
            id="sf-note"
            label={t('shop.note')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
          />
          {error && (
            <p role="alert" className="ui-text-muted">
              {error}
            </p>
          )}
          {done ? (
            <p className="ui-text-muted">{done}</p>
          ) : (
            <Button type="submit" disabled={busy || !canSubmit} block>
              {busy ? t('shop.submitting') : t('shop.submit')}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
