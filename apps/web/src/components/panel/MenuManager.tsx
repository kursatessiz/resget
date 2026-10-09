'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ALLERGENS,
  DIETARY_TAGS,
  WEEKDAY_KEYS,
  dietaryConflicts,
  formatMoney,
  MAX_STOCK_QUANTITY,
  majorAmountText,
  parseMajorAmount,
} from '@resget/shared';
import type {
  Allergen,
  DietaryTag,
  OpeningHours,
  WeekdayKey,
  MenuAdminDTO,
  MenuCategoryAdminDTO,
  MenuItemAdminDTO,
  ModifierGroupInput,
  Translate,
} from '@resget/shared';
import { Badge, Button, Card, SelectField, TextAreaField, TextField } from '@/components/ui';
import { ApiError, bffJson } from '@/lib/client-api';
import { AiMenuAssistant } from './AiAssistant';
import { MenuImport } from './MenuImport';
import { useT } from '@/lib/use-t';

interface Editing {
  categoryId: string;
  item: MenuItemAdminDTO | null;
}

/**
 * The menu editor: categories, items and option groups of the restaurant.
 * Every change goes to the API and the returned row replaces the local one,
 * so the screen never computes a price or an order on its own.
 */
export function MenuManager({
  restaurantId,
  locale,
  canManage,
  aiStudio = false,
  allergens = false,
  dayparts = false,
  stations = false,
  stock = false,
}: {
  restaurantId: string;
  locale: string;
  canManage: boolean;
  /** The ai_studio module is on and the plan allows it: description drafts in the item editor (docs/YAPAY_ZEKA.md). */
  aiStudio?: boolean;
  /** The allergens module is on: allergen and dietary tag boxes in the item editor (docs/ALERJENLER.md). */
  allergens?: boolean;
  /** The menu_dayparts module is on: serving hours per category (docs/OGUN_SAATLERI.md). */
  dayparts?: boolean;
  /** The kitchen_display module is on: a kitchen station per category (docs/MUTFAK_EKRANI.md). */
  stations?: boolean;
  /** The menu_stock module is on: portions left per item (docs/STOK.md). */
  stock?: boolean;
}) {
  const t = useT(locale);
  const base = `restaurants/${restaurantId}/menu`;
  const [menu, setMenu] = useState<MenuAdminDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [hoursOf, setHoursOf] = useState<string | null>(null);
  const [stationOf, setStationOf] = useState<{ id: string; name: string } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  const fail = useCallback(
    (err: unknown) => setError(err instanceof ApiError ? t(`errors.${err.code}`) : t('common.error.network')),
    [t],
  );

  useEffect(() => {
    let cancelled = false;
    bffJson<MenuAdminDTO>(`${base}/manage`)
      .then((data) => {
        if (!cancelled) setMenu(data);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [base, fail]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const replaceCategory = (category: MenuCategoryAdminDTO) =>
    setMenu((m) => m && { ...m, categories: m.categories.map((c) => (c.id === category.id ? category : c)) });

  const replaceItem = (item: MenuItemAdminDTO) =>
    setMenu(
      (m) =>
        m && {
          ...m,
          categories: m.categories.map((c) => {
            if (c.id !== item.categoryId) return { ...c, items: c.items.filter((i) => i.id !== item.id) };
            const exists = c.items.some((i) => i.id === item.id);
            return { ...c, items: exists ? c.items.map((i) => (i.id === item.id ? item : i)) : [...c.items, item] };
          }),
        },
    );

  const addCategory = () =>
    run(async () => {
      const name = newCategory.trim();
      if (!name) return;
      const created = await bffJson<MenuCategoryAdminDTO>(`${base}/categories`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setMenu((m) => m && { ...m, categories: [...m.categories, created] });
      setNewCategory('');
    });

  const patchCategory = (id: string, body: Record<string, unknown>) =>
    run(async () => {
      replaceCategory(
        await bffJson<MenuCategoryAdminDTO>(`${base}/categories/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        }),
      );
      setRenaming(null);
    });

  const deleteCategory = (id: string) => {
    if (!window.confirm(t('menu.manage.confirmDeleteCategory'))) return;
    void run(async () => {
      await bffJson<void>(`${base}/categories/${id}`, { method: 'DELETE' });
      setMenu((m) => m && { ...m, categories: m.categories.filter((c) => c.id !== id) });
    });
  };

  const moveCategory = (index: number, direction: -1 | 1) =>
    run(async () => {
      if (!menu) return;
      const ids = menu.categories.map((c) => c.id);
      const target = index + direction;
      if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      setMenu(
        await bffJson<MenuAdminDTO>(`${base}/categories/reorder`, { method: 'POST', body: JSON.stringify({ ids }) }),
      );
    });

  const moveItem = (category: MenuCategoryAdminDTO, index: number, direction: -1 | 1) =>
    run(async () => {
      const ids = category.items.map((i) => i.id);
      const target = index + direction;
      if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      replaceCategory(
        await bffJson<MenuCategoryAdminDTO>(`${base}/categories/${category.id}/items/reorder`, {
          method: 'POST',
          body: JSON.stringify({ ids }),
        }),
      );
    });

  const patchItem = (id: string, body: Record<string, unknown>) =>
    run(async () => {
      replaceItem(
        await bffJson<MenuItemAdminDTO>(`${base}/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
      );
    });

  const deleteItem = (item: MenuItemAdminDTO) => {
    if (!window.confirm(t('menu.manage.confirmDeleteItem'))) return;
    void run(async () => {
      await bffJson<void>(`${base}/items/${item.id}`, { method: 'DELETE' });
      setMenu(
        (m) =>
          m && {
            ...m,
            categories: m.categories.map((c) =>
              c.id === item.categoryId ? { ...c, items: c.items.filter((i) => i.id !== item.id) } : c,
            ),
          },
      );
    });
  };

  const saveItem = (payload: Record<string, unknown>, existing: MenuItemAdminDTO | null) =>
    run(async () => {
      const saved = existing
        ? await bffJson<MenuItemAdminDTO>(`${base}/items/${existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await bffJson<MenuItemAdminDTO>(`${base}/items`, { method: 'POST', body: JSON.stringify(payload) });
      replaceItem(saved);
      setEditing(null);
    });

  const saveGroups = (item: MenuItemAdminDTO, groups: ModifierGroupInput[]) =>
    run(async () => {
      const saved = await bffJson<MenuItemAdminDTO>(`${base}/items/${item.id}/modifier-groups`, {
        method: 'PUT',
        body: JSON.stringify({ groups }),
      });
      replaceItem(saved);
      setEditing({ categoryId: saved.categoryId, item: saved });
    });

  if (!menu) {
    return (
      <>
        <h1 className="ui-title">{t('menu.manage.title')}</h1>
        <p className="ui-text-muted">{error ?? t('common.loading')}</p>
      </>
    );
  }

  const categoryOptions = menu.categories.map((c) => ({ id: c.id, name: c.name }));
  // A new item starts with the rate most of the menu already uses; the platform assumes no country's rate.
  const usualVatBps = mostCommon(menu.categories.flatMap((c) => c.items.map((i) => i.vatRateBps)));

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="ui-title">{t('menu.manage.title')}</h1>
        <p className="ui-text-muted">{t('menu.manage.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="ui-text-muted">
          {error}
        </p>
      )}

      {canManage && (
        <Card>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void addCategory();
            }}
          >
            <TextField
              id="new-category"
              label={t('menu.manage.categoryName')}
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
              maxLength={80}
              required
            />
            <Button type="submit" disabled={busy}>
              {t('menu.manage.addCategory')}
            </Button>
          </form>
        </Card>
      )}

      {canManage && (
        <MenuImport
          restaurantId={restaurantId}
          t={t}
          onApplied={async () => setMenu(await bffJson<MenuAdminDTO>(`${base}/manage`))}
        />
      )}

      {menu.categories.length === 0 && <p className="ui-text-muted">{t('menu.manage.empty')}</p>}

      {menu.categories.map((category, index) => (
        <Card
          key={category.id}
          aria-label={category.name}
          title={
            renaming?.id === category.id ? (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void patchCategory(category.id, { name: renaming.name.trim() });
                }}
              >
                <TextField
                  id={`rename-${category.id}`}
                  label={t('menu.manage.categoryName')}
                  value={renaming.name}
                  onChange={(event) => setRenaming({ id: category.id, name: event.target.value })}
                  maxLength={80}
                  required
                />
                <Button type="submit" disabled={busy}>
                  {t('common.save')}
                </Button>
                <Button variant="outline" tone="muted" onClick={() => setRenaming(null)}>
                  {t('common.cancel')}
                </Button>
              </form>
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                {category.name}
                {!category.isActive && <Badge tone="warn">{t('menu.manage.hidden')}</Badge>}
                <span className="ui-caption">{t('menu.manage.itemCount', { count: category.items.length })}</span>
                {dayparts && category.availableHours && (
                  <Badge tone="theme">
                    {t('dayparts.manage.summary', { hours: hoursSummary(t, category.availableHours) })}
                  </Badge>
                )}
                {stations && category.kitchenStation && (
                  <Badge tone="muted">{t('kitchen.station.badge', { station: category.kitchenStation })}</Badge>
                )}
              </span>
            )
          }
          aside={
            canManage && renaming?.id !== category.id ? (
              <span className="flex flex-wrap gap-1">
                <Button
                  variant="link"
                  tone="muted"
                  disabled={busy || index === 0}
                  onClick={() => moveCategory(index, -1)}
                >
                  {t('menu.manage.moveUp')}
                </Button>
                <Button
                  variant="link"
                  tone="muted"
                  disabled={busy || index === menu.categories.length - 1}
                  onClick={() => moveCategory(index, 1)}
                >
                  {t('menu.manage.moveDown')}
                </Button>
                <Button
                  variant="link"
                  tone="muted"
                  onClick={() => setRenaming({ id: category.id, name: category.name })}
                >
                  {t('menu.manage.rename')}
                </Button>
                {dayparts && (
                  <Button
                    variant="link"
                    tone="muted"
                    onClick={() => setHoursOf(hoursOf === category.id ? null : category.id)}
                  >
                    {t('dayparts.manage.title')}
                  </Button>
                )}
                {stations && (
                  <Button
                    variant="link"
                    tone="muted"
                    onClick={() =>
                      setStationOf(
                        stationOf?.id === category.id ? null : { id: category.id, name: category.kitchenStation ?? '' },
                      )
                    }
                  >
                    {t('kitchen.station.manage')}
                  </Button>
                )}
                <Button
                  variant="link"
                  tone="muted"
                  disabled={busy}
                  onClick={() => patchCategory(category.id, { isActive: !category.isActive })}
                >
                  {category.isActive ? t('menu.manage.hide') : t('menu.manage.show')}
                </Button>
                <Button variant="link" tone="error" disabled={busy} onClick={() => deleteCategory(category.id)}>
                  {t('menu.manage.deleteCategory')}
                </Button>
              </span>
            ) : undefined
          }
        >
          {dayparts && hoursOf === category.id && (
            <ServingHoursEditor
              t={t}
              hours={category.availableHours}
              busy={busy}
              onSave={(availableHours) => {
                void patchCategory(category.id, { availableHours });
                setHoursOf(null);
              }}
              onCancel={() => setHoursOf(null)}
            />
          )}
          {stations && stationOf?.id === category.id && (
            <form
              aria-label={t('kitchen.station.manage')}
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const name = stationOf.name.trim();
                void patchCategory(category.id, { kitchenStation: name === '' ? null : name });
                setStationOf(null);
              }}
            >
              <TextField
                id={`station-${category.id}`}
                label={t('kitchen.station.name')}
                help={t('kitchen.station.help')}
                value={stationOf.name}
                onChange={(event) => setStationOf({ id: category.id, name: event.target.value })}
                maxLength={40}
              />
              <Button type="submit" disabled={busy}>
                {t('common.save')}
              </Button>
              {category.kitchenStation && (
                <Button
                  variant="outline"
                  tone="muted"
                  disabled={busy}
                  onClick={() => {
                    void patchCategory(category.id, { kitchenStation: null });
                    setStationOf(null);
                  }}
                >
                  {t('kitchen.station.clear')}
                </Button>
              )}
              <Button variant="link" tone="muted" onClick={() => setStationOf(null)}>
                {t('common.cancel')}
              </Button>
            </form>
          )}
          {category.items.length === 0 && <p className="ui-text-muted">{t('menu.emptyCategory')}</p>}
          <ul className="ui-divide">
            {category.items.map((item, itemIndex) => (
              <li key={item.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="ui-heading">{item.name}</span>
                    <Badge tone={item.isAvailable ? 'success' : 'warn'}>
                      {item.isAvailable ? t('menu.available') : t('menu.unavailable')}
                    </Badge>
                    {stock && item.stockQuantity !== null && (
                      <Badge tone={item.stockQuantity > 0 ? 'muted' : 'error'} data-stock={item.stockQuantity}>
                        {item.stockQuantity > 0
                          ? t('stock.manage.left', { count: item.stockQuantity })
                          : t('stock.manage.soldOut')}
                      </Badge>
                    )}
                    {item.modifierGroups.length > 0 && (
                      <Badge>{t('menu.manage.modifiers.count', { count: item.modifierGroups.length })}</Badge>
                    )}
                  </span>
                  <span className="ui-price">
                    {formatMoney({ amountMinor: item.priceMinor, currency: item.currency }, locale)}
                    <span className="ui-caption">
                      {' '}
                      / {t('menu.vatRate')} %{item.vatRateBps / 100}
                    </span>
                  </span>
                </div>
                {item.description && <p className="ui-caption">{item.description}</p>}
                {canManage && (
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="outline"
                      tone="muted"
                      disabled={busy}
                      onClick={() => setEditing({ categoryId: category.id, item })}
                    >
                      {t('menu.manage.editItem')}
                    </Button>
                    <Button
                      variant="outline"
                      tone={item.isAvailable ? 'warn' : 'success'}
                      disabled={busy}
                      onClick={() => patchItem(item.id, { isAvailable: !item.isAvailable })}
                    >
                      {item.isAvailable ? t('menu.manage.markUnavailable') : t('menu.manage.markAvailable')}
                    </Button>
                    <Button
                      variant="link"
                      tone="muted"
                      disabled={busy || itemIndex === 0}
                      onClick={() => moveItem(category, itemIndex, -1)}
                    >
                      {t('menu.manage.moveUp')}
                    </Button>
                    <Button
                      variant="link"
                      tone="muted"
                      disabled={busy || itemIndex === category.items.length - 1}
                      onClick={() => moveItem(category, itemIndex, 1)}
                    >
                      {t('menu.manage.moveDown')}
                    </Button>
                    <Button variant="link" tone="error" disabled={busy} onClick={() => deleteItem(item)}>
                      {t('menu.manage.deleteItem')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canManage && editing?.categoryId === category.id ? (
            <ItemEditor
              key={editing.item?.id ?? 'new'}
              t={t}
              currency={menu.currency}
              defaultVatBps={usualVatBps}
              categories={categoryOptions}
              categoryId={category.id}
              item={editing.item}
              busy={busy}
              aiAssist={aiStudio ? { restaurantId, locale } : null}
              withAllergens={allergens}
              withStock={stock}
              onSave={(payload) => void saveItem(payload, editing.item)}
              onSaveGroups={(groups) => {
                if (editing.item) void saveGroups(editing.item, groups);
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            canManage && (
              <div>
                <Button
                  variant="soft"
                  disabled={busy}
                  onClick={() => setEditing({ categoryId: category.id, item: null })}
                >
                  {t('menu.manage.addItem')}
                </Button>
              </div>
            )
          )}
        </Card>
      ))}
    </>
  );
}

interface GroupDraft {
  name: string;
  minSelect: string;
  maxSelect: string;
  modifiers: { name: string; priceDelta: string; isAvailable: boolean }[];
}

function ItemEditor({
  t,
  currency,
  defaultVatBps,
  categories,
  categoryId,
  item,
  busy,
  aiAssist,
  withAllergens,
  withStock,
  onSave,
  onSaveGroups,
  onCancel,
}: {
  t: Translate;
  aiAssist: { restaurantId: string; locale: string } | null;
  withAllergens: boolean;
  withStock: boolean;
  currency: string;
  defaultVatBps: number | null;
  categories: { id: string; name: string }[];
  categoryId: string;
  item: MenuItemAdminDTO | null;
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => void;
  onSaveGroups: (groups: ModifierGroupInput[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [price, setPrice] = useState(item ? majorAmountText(item.priceMinor, currency) : '');
  const [vatPercent, setVatPercent] = useState(
    item ? String(item.vatRateBps / 100) : defaultVatBps !== null ? String(defaultVatBps / 100) : '',
  );
  const [imageUrl, setImageUrl] = useState(item?.imageUrl ?? '');
  const [category, setCategory] = useState(item?.categoryId ?? categoryId);
  const [isAvailable, setIsAvailable] = useState(item?.isAvailable ?? true);
  const [stockText, setStockText] = useState(
    item?.stockQuantity === null || item?.stockQuantity === undefined ? '' : String(item.stockQuantity),
  );
  const [allergenSet, setAllergenSet] = useState<Allergen[]>(item?.allergens ?? []);
  const [tagSet, setTagSet] = useState<DietaryTag[]>(item?.dietaryTags ?? []);
  const conflicts = dietaryConflicts(allergenSet, tagSet);
  const [formError, setFormError] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupDraft[]>(
    (item?.modifierGroups ?? []).map((g) => ({
      name: g.name,
      minSelect: String(g.minSelect),
      maxSelect: String(g.maxSelect),
      modifiers: g.modifiers.map((m) => ({
        name: m.name,
        priceDelta: majorAmountText(m.priceDeltaMinor, currency),
        isAvailable: m.isAvailable,
      })),
    })),
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const priceMinor = parseMajorAmount(price, currency);
    // A blank rate is a missing rate, not zero.
    const vatText = vatPercent.trim().replace(',', '.');
    const vat = vatText === '' ? Number.NaN : Number(vatText);
    if (priceMinor === null || priceMinor < 0 || !Number.isFinite(vat) || vat < 0 || vat > 100) {
      setFormError(t('menu.manage.invalidPrice'));
      return;
    }
    const stockQuantity = stockText.trim() === '' ? null : Number(stockText.trim());
    if (
      stockQuantity !== null &&
      (!Number.isInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > MAX_STOCK_QUANTITY)
    ) {
      setFormError(t('stock.manage.invalid'));
      return;
    }
    setFormError(null);
    onSave({
      categoryId: category,
      name: name.trim(),
      description: description.trim() || null,
      priceMinor,
      vatRateBps: Math.round(vat * 100),
      imageUrl: imageUrl.trim() || null,
      isAvailable,
      ...(withStock ? { stockQuantity } : {}),
      // Kept in catalogue order, so the saved list reads the same as the boxes.
      ...(withAllergens
        ? {
            allergens: ALLERGENS.filter((a) => allergenSet.includes(a)),
            dietaryTags: DIETARY_TAGS.filter((d) => tagSet.includes(d)),
          }
        : {}),
    });
  };

  const submitGroups = () => {
    const parsed: ModifierGroupInput[] = [];
    for (const group of groups) {
      const modifiers: ModifierGroupInput['modifiers'] = [];
      for (const modifier of group.modifiers) {
        const delta = parseMajorAmount(modifier.priceDelta || '0', currency);
        if (delta === null) {
          setFormError(t('menu.manage.invalidPrice'));
          return;
        }
        modifiers.push({ name: modifier.name.trim(), priceDeltaMinor: delta, isAvailable: modifier.isAvailable });
      }
      parsed.push({
        name: group.name.trim(),
        minSelect: Number(group.minSelect),
        maxSelect: Number(group.maxSelect),
        modifiers,
      });
    }
    setFormError(null);
    onSaveGroups(parsed);
  };

  const updateGroup = (index: number, patch: Partial<GroupDraft>) =>
    setGroups((gs) => gs.map((g, i) => (i === index ? { ...g, ...patch } : g)));

  return (
    <form
      className="ui-divide flex flex-col gap-4"
      onSubmit={submit}
      aria-label={item ? t('menu.manage.editItem') : t('menu.manage.newItem')}
    >
      <div className="grid gap-3 pt-3 md:grid-cols-2">
        <TextField
          id="item-name"
          label={t('menu.manage.itemName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
        />
        <SelectField
          id="item-category"
          label={t('menu.manage.category')}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <TextField
          id="item-price"
          label={t('menu.manage.price', { currency })}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          required
        />
        <TextField
          id="item-vat"
          label={t('menu.manage.vatPercent')}
          value={vatPercent}
          onChange={(e) => setVatPercent(e.target.value)}
          inputMode="decimal"
          required
        />
        <TextAreaField
          id="item-description"
          label={t('menu.manage.description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          className="md:col-span-2"
        />
        {aiAssist && (
          <AiMenuAssistant
            restaurantId={aiAssist.restaurantId}
            locale={aiAssist.locale}
            itemName={name}
            onUse={setDescription}
          />
        )}
        <TextField
          id="item-image"
          label={t('menu.manage.imageUrl')}
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          type="url"
        />
        <label className="flex items-center gap-2 self-end">
          <input
            type="checkbox"
            className="pui-checkbox"
            checked={isAvailable}
            onChange={(e) => setIsAvailable(e.target.checked)}
          />
          <span>{t('menu.manage.available')}</span>
        </label>
        {withStock && (
          <TextField
            label={t('stock.manage.field')}
            help={t('stock.manage.help')}
            inputMode="numeric"
            value={stockText}
            onChange={(event) => setStockText(event.target.value)}
          />
        )}
      </div>
      {withAllergens && (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="ui-label">{t('allergens.manage.allergens')}</legend>
            <div className="flex flex-wrap gap-3">
              {ALLERGENS.map((allergen) => (
                <label key={allergen} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="pui-checkbox"
                    checked={allergenSet.includes(allergen)}
                    onChange={(e) =>
                      setAllergenSet((current) =>
                        e.target.checked ? [...current, allergen] : current.filter((a) => a !== allergen),
                      )
                    }
                  />
                  <span>{t(`allergens.name.${allergen}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="ui-label">{t('allergens.manage.dietaryTags')}</legend>
            <div className="flex flex-wrap gap-3">
              {DIETARY_TAGS.map((tag) => (
                <label key={tag} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="pui-checkbox"
                    checked={tagSet.includes(tag)}
                    onChange={(e) =>
                      setTagSet((current) => (e.target.checked ? [...current, tag] : current.filter((d) => d !== tag)))
                    }
                  />
                  <span>{t(`allergens.diet.${tag}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {conflicts.length > 0 && (
            <p className="pui-alert pui-warn" data-allergen-conflict>
              {t('allergens.manage.conflict', { tags: conflicts.map((c) => t(`allergens.diet.${c}`)).join(', ') })}
            </p>
          )}
          <p className="ui-caption">{t('allergens.manage.responsibility')}</p>
        </div>
      )}
      {formError && (
        <p role="alert" className="ui-text-muted">
          {formError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {t('common.save')}
        </Button>
        <Button variant="outline" tone="muted" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>

      {item && (
        <section className="flex flex-col gap-3 pt-3" aria-label={t('menu.manage.modifiers.title')}>
          <h3 className="ui-heading">{t('menu.manage.modifiers.title')}</h3>
          <p className="ui-caption">{t('menu.manage.modifiers.hint')}</p>
          {groups.length === 0 && <p className="ui-text-muted">{t('menu.manage.modifiers.none')}</p>}
          {groups.map((group, gi) => (
            <div key={gi} className="flex flex-col gap-2">
              <div className="grid gap-2 md:grid-cols-4">
                <TextField
                  id={`group-name-${gi}`}
                  label={t('menu.manage.modifiers.groupName')}
                  value={group.name}
                  onChange={(e) => updateGroup(gi, { name: e.target.value })}
                  className="md:col-span-2"
                  required
                />
                <TextField
                  id={`group-min-${gi}`}
                  label={t('menu.manage.modifiers.min')}
                  type="number"
                  min={0}
                  max={20}
                  value={group.minSelect}
                  onChange={(e) => updateGroup(gi, { minSelect: e.target.value })}
                />
                <TextField
                  id={`group-max-${gi}`}
                  label={t('menu.manage.modifiers.max')}
                  type="number"
                  min={1}
                  max={20}
                  value={group.maxSelect}
                  onChange={(e) => updateGroup(gi, { maxSelect: e.target.value })}
                />
              </div>
              {group.modifiers.map((modifier, mi) => (
                <div key={mi} className="grid items-end gap-2 md:grid-cols-4">
                  <TextField
                    id={`mod-name-${gi}-${mi}`}
                    label={t('menu.manage.modifiers.optionName')}
                    value={modifier.name}
                    onChange={(e) =>
                      updateGroup(gi, {
                        modifiers: group.modifiers.map((m, i) => (i === mi ? { ...m, name: e.target.value } : m)),
                      })
                    }
                    className="md:col-span-2"
                    required
                  />
                  <TextField
                    id={`mod-delta-${gi}-${mi}`}
                    label={t('menu.manage.modifiers.priceDelta', { currency })}
                    value={modifier.priceDelta}
                    inputMode="decimal"
                    onChange={(e) =>
                      updateGroup(gi, {
                        modifiers: group.modifiers.map((m, i) => (i === mi ? { ...m, priceDelta: e.target.value } : m)),
                      })
                    }
                  />
                  <Button
                    variant="link"
                    tone="error"
                    onClick={() => updateGroup(gi, { modifiers: group.modifiers.filter((_, i) => i !== mi) })}
                  >
                    {t('menu.manage.modifiers.removeOption')}
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="soft"
                  tone="muted"
                  onClick={() =>
                    updateGroup(gi, {
                      modifiers: [...group.modifiers, { name: '', priceDelta: '', isAvailable: true }],
                    })
                  }
                >
                  {t('menu.manage.modifiers.addOption')}
                </Button>
                <Button variant="link" tone="error" onClick={() => setGroups((gs) => gs.filter((_, i) => i !== gi))}>
                  {t('menu.manage.modifiers.removeGroup')}
                </Button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="soft"
              tone="muted"
              onClick={() =>
                setGroups((gs) => [
                  ...gs,
                  {
                    name: '',
                    minSelect: '0',
                    maxSelect: '1',
                    modifiers: [{ name: '', priceDelta: '', isAvailable: true }],
                  },
                ])
              }
            >
              {t('menu.manage.modifiers.addGroup')}
            </Button>
            <Button variant="outline" disabled={busy} onClick={submitGroups}>
              {t('menu.manage.modifiers.save')}
            </Button>
          </div>
        </section>
      )}
    </form>
  );
}

/** "Mon, Tue 07:00 - 11:00": the days that share the first window, for the category badge. */
function hoursSummary(t: Translate, hours: OpeningHours): string {
  const days = WEEKDAY_KEYS.filter((day) => (hours[day] ?? []).length > 0);
  const first = days.length > 0 ? (hours[days[0]] ?? [])[0] : undefined;
  if (!first) return '';
  return `${days.map((day) => t(`dayparts.day.${day}`)).join(', ')} ${first[0]} - ${first[1]}`;
}

/**
 * Serving hours of a category: always, or one window on the chosen days
 * (docs/OGUN_SAATLERI.md). Stored in the opening hours shape, so the same
 * rules decide on the server and on the ordering page.
 */
function ServingHoursEditor({
  t,
  hours,
  busy,
  onSave,
  onCancel,
}: {
  t: Translate;
  hours: OpeningHours | null;
  busy: boolean;
  onSave: (hours: OpeningHours | null) => void;
  onCancel: () => void;
}) {
  const firstDay = WEEKDAY_KEYS.find((day) => (hours?.[day] ?? []).length > 0);
  const firstWindow = firstDay ? (hours?.[firstDay] ?? [])[0] : undefined;
  const [limited, setLimited] = useState(hours !== null);
  const [days, setDays] = useState<WeekdayKey[]>(
    hours ? WEEKDAY_KEYS.filter((day) => (hours[day] ?? []).length > 0) : [...WEEKDAY_KEYS],
  );
  const [from, setFrom] = useState(firstWindow?.[0] ?? '07:00');
  const [to, setTo] = useState(firstWindow?.[1] ?? '11:00');
  const valid = !limited || (days.length > 0 && from !== to && /^\d{2}:\d{2}$/.test(from) && /^\d{2}:\d{2}$/.test(to));

  return (
    <form
      className="flex flex-col gap-3"
      aria-label={t('dayparts.manage.title')}
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onSave(limited ? Object.fromEntries(days.map((day) => [day, [[from, to]]])) : null);
      }}
    >
      <p className="ui-caption">{t('dayparts.manage.help')}</p>
      <label className="flex items-center gap-2">
        <input type="radio" className="pui-radio" checked={!limited} onChange={() => setLimited(false)} />
        <span>{t('dayparts.manage.always')}</span>
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" className="pui-radio" checked={limited} onChange={() => setLimited(true)} />
        <span>{t('dayparts.manage.window')}</span>
      </label>
      {limited && (
        <>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="ui-label">{t('dayparts.manage.days')}</legend>
            {WEEKDAY_KEYS.map((day) => (
              <label key={day} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="pui-checkbox"
                  checked={days.includes(day)}
                  onChange={(e) =>
                    setDays((current) => (e.target.checked ? [...current, day] : current.filter((d) => d !== day)))
                  }
                />
                <span>{t(`dayparts.day.${day}`)}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <TextField
              id="daypart-from"
              type="time"
              label={t('dayparts.manage.from')}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <TextField
              id="daypart-to"
              type="time"
              label={t('dayparts.manage.to')}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          {!valid && <p className="pui-alert pui-warn">{t('dayparts.manage.invalid')}</p>}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !valid}>
          {t('common.save')}
        </Button>
        <Button variant="outline" tone="muted" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** The value seen most often, or null for an empty list. */
function mostCommon(values: readonly number[]): number | null {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | null = null;
  for (const [value, count] of counts) if (best === null || count > (counts.get(best) ?? 0)) best = value;
  return best;
}
