'use client';

import { useState } from 'react';
import {
  ENUM_FIELD_VALUES,
  SEGMENT_FIELDS,
  SEGMENT_FIELD_KEYS,
  SEGMENT_MAX_DEPTH,
  SEGMENT_OPERATORS,
  isSegmentGroup,
  minorDigitsOf,
} from '@resget/shared';
import type { SegmentCondition, SegmentField, SegmentGroup } from '@resget/shared';
import { Button, SelectField, TextField } from '@/components/ui';
import { useT } from '@/lib/use-t';

export interface StageOption {
  id: string;
  label: string;
}

interface Props {
  value: SegmentGroup;
  onChange: (next: SegmentGroup) => void;
  locale: string;
  stages: StageOption[];
  /** The tenant's currency: spend is typed in its major unit and kept in minor units. */
  currency: string;
  depth?: number;
}

function defaultValue(field: SegmentField, stages: StageOption[]): SegmentCondition['value'] {
  switch (SEGMENT_FIELDS[field].type) {
    case 'number':
      return 1;
    case 'days':
      return 30;
    case 'tags':
      return [];
    case 'enum':
      return [ENUM_FIELD_VALUES[field as 'firstChannel' | 'consentChannel'][0]];
    case 'boolean':
      return true;
    case 'id':
      return stages[0]?.id ?? '';
    default:
      return '';
  }
}

/** Comma separated list; keeps what is typed (a trailing comma included) and hands up the clean list. */
function TagsField({ label, value, onChange }: { label: string; value: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <TextField
      label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}

export function newCondition(field: SegmentField = 'orderCount', stages: StageOption[] = []): SegmentCondition {
  return { field, op: SEGMENT_OPERATORS[SEGMENT_FIELDS[field].type][0], value: defaultValue(field, stages) };
}

/**
 * Edits a rule tree (docs/SEGMENTLER.md): each group joins its rules with
 * AND or OR; a rule is a condition or a nested group, up to three levels.
 * Values are typed by the field; lists are comma separated.
 */
export function SegmentBuilder({ value, onChange, locale, stages, currency, depth = 1 }: Props) {
  const t = useT(locale);
  const scale = 10 ** minorDigitsOf(currency);
  const fields = SEGMENT_FIELD_KEYS.filter((f) => f !== 'stageId' || stages.length > 0);

  const setRule = (index: number, rule: SegmentCondition | SegmentGroup) =>
    onChange({ ...value, rules: value.rules.map((r, i) => (i === index ? rule : r)) });
  const removeRule = (index: number) => onChange({ ...value, rules: value.rules.filter((_, i) => i !== index) });

  const conditionEditor = (condition: SegmentCondition, index: number) => {
    const type = SEGMENT_FIELDS[condition.field].type;
    const ops: readonly string[] = SEGMENT_OPERATORS[type];
    const valueInput = (() => {
      if (condition.field === 'lifetimeGrossMinor') {
        return (
          <TextField
            label={t('segments.value.amount', { currency })}
            type="number"
            min={0}
            step={1 / scale}
            value={String(Number(condition.value) / scale)}
            onChange={(e) => setRule(index, { ...condition, value: Math.round(Number(e.target.value) * scale) })}
          />
        );
      }
      if (type === 'number' || type === 'days') {
        return (
          <TextField
            label={type === 'days' ? t('segments.value.days') : t('segments.value.number')}
            type="number"
            min={type === 'days' ? 1 : 0}
            value={String(condition.value)}
            onChange={(e) => setRule(index, { ...condition, value: Number(e.target.value) })}
          />
        );
      }
      if (type === 'boolean') {
        return (
          <SelectField
            label={t('segments.value.value')}
            value={condition.value === true ? 'true' : 'false'}
            onChange={(e) => setRule(index, { ...condition, value: e.target.value === 'true' })}
          >
            <option value="true">{t('segments.value.yes')}</option>
            <option value="false">{t('segments.value.no')}</option>
          </SelectField>
        );
      }
      if (type === 'id') {
        return (
          <SelectField
            label={t('segments.value.value')}
            value={String(condition.value)}
            onChange={(e) => setRule(index, { ...condition, value: e.target.value })}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </SelectField>
        );
      }
      if (type === 'enum') {
        const options = ENUM_FIELD_VALUES[condition.field as 'firstChannel' | 'consentChannel'];
        const chosen = Array.isArray(condition.value) ? condition.value : [];
        return (
          <fieldset className="flex flex-wrap gap-3">
            <legend className="ui-caption">{t('segments.value.value')}</legend>
            {options.map((option) => (
              <label key={option} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="pui-checkbox"
                  checked={chosen.includes(option)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...chosen, option] : chosen.filter((c) => c !== option);
                    setRule(index, { ...condition, value: next.length > 0 ? next : [option] });
                  }}
                />
                <span>{t(`segments.enum.${condition.field}.${option}`)}</span>
              </label>
            ))}
          </fieldset>
        );
      }
      if (type === 'tags') {
        return (
          <TagsField
            label={t('segments.value.tags')}
            value={Array.isArray(condition.value) ? condition.value : []}
            onChange={(tags) => setRule(index, { ...condition, value: tags })}
          />
        );
      }
      return (
        <TextField
          label={t('segments.value.value')}
          value={String(condition.value)}
          onChange={(e) => setRule(index, { ...condition, value: e.target.value })}
        />
      );
    })();
    return (
      <div
        className="grid gap-2 md:grid-cols-[1fr_1fr_1.5fr_auto] md:items-end"
        data-segment-condition={condition.field}
      >
        <SelectField
          label={t('segments.field.label')}
          value={condition.field}
          onChange={(e) => setRule(index, newCondition(e.target.value as SegmentField, stages))}
        >
          {fields.map((field) => (
            <option key={field} value={field}>
              {t(`segments.field.${field}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('segments.op.label')}
          value={condition.op}
          onChange={(e) => setRule(index, { ...condition, op: e.target.value })}
        >
          {ops.map((op) => (
            <option key={op} value={op}>
              {t(`segments.op.${op}`)}
            </option>
          ))}
        </SelectField>
        {valueInput}
        <Button variant="link" tone="error" onClick={() => removeRule(index)}>
          {t('segments.remove')}
        </Button>
      </div>
    );
  };

  return (
    <fieldset className="flex flex-col gap-3 ui-rule pt-3" data-segment-group={depth}>
      <legend className="flex items-center gap-2">
        <SelectField
          label={t('segments.group.join')}
          value={value.op}
          onChange={(e) => onChange({ ...value, op: e.target.value as 'AND' | 'OR' })}
        >
          <option value="AND">{t('segments.group.AND')}</option>
          <option value="OR">{t('segments.group.OR')}</option>
        </SelectField>
      </legend>
      {value.rules.length === 0 && <p className="ui-caption">{t('segments.group.empty')}</p>}
      {value.rules.map((rule, index) =>
        isSegmentGroup(rule) ? (
          <div key={index} className="flex flex-col gap-2">
            <SegmentBuilder
              value={rule}
              onChange={(next) => setRule(index, next)}
              locale={locale}
              stages={stages}
              currency={currency}
              depth={depth + 1}
            />
            <div>
              <Button variant="link" tone="error" onClick={() => removeRule(index)}>
                {t('segments.removeGroup')}
              </Button>
            </div>
          </div>
        ) : (
          <div key={index}>{conditionEditor(rule, index)}</div>
        ),
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          tone="muted"
          onClick={() => onChange({ ...value, rules: [...value.rules, newCondition('orderCount', stages)] })}
        >
          {t('segments.addCondition')}
        </Button>
        {depth < SEGMENT_MAX_DEPTH && (
          <Button
            variant="outline"
            tone="muted"
            onClick={() =>
              onChange({
                ...value,
                rules: [
                  ...value.rules,
                  { op: value.op === 'AND' ? 'OR' : 'AND', rules: [newCondition('orderCount', stages)] },
                ],
              })
            }
          >
            {t('segments.addGroup')}
          </Button>
        )}
      </div>
    </fieldset>
  );
}
