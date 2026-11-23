import { describe, expect, it } from 'vitest';
import {
  defaultMetricFor,
  domainOf,
  emptyFields,
  fieldsOf,
  isDirty,
  issueFieldName,
  issueLabel,
  originText,
  toPayload,
  warningText,
} from './briefLogic';
import { brief, registry } from './testFixtures';

describe('briefLogic', () => {
  it('trims text and drops empty list rows before saving', () => {
    const values = {
      ...emptyFields('saves'),
      objective: '  Teach one thing  ',
      must_include: ['  four moves ', '', '   '],
      references: [
        { title: 'Source', url: ' https://example.org ' },
        { title: '', url: '' },
      ],
      note: '  ',
    };
    expect(toPayload(values)).toEqual({
      objective: 'Teach one thing',
      key_message: '',
      hook_direction: '',
      audience_note: '',
      cta: '',
      must_include: ['four moves'],
      must_avoid: [],
      references: [{ title: 'Source', url: 'https://example.org' }],
      format_notes: '',
      success_metric: 'saves',
    });
  });

  it('does not count the change note as a change', () => {
    const start = fieldsOf(brief());
    expect(isDirty(start, { ...start, note: 'Restored' })).toBe(false);
    expect(isDirty(start, { ...start, cta: 'Book now' })).toBe(true);
    expect(isDirty(start, { ...start, cta: `${start.cta}  ` })).toBe(false);
  });

  it('prefills a restore with the note "Restored from v{k}"', () => {
    expect(fieldsOf(brief({ version: 1 }), 'Restored from v1').note).toBe('Restored from v1');
  });

  it('uses the story default metric for stories', () => {
    const engage = registry.roles?.find((r) => r.key === 'engage');
    expect(defaultMetricFor(engage, 'story')).toBe('replies');
    expect(defaultMetricFor(engage, 'reel')).toBe('comments');
    expect(defaultMetricFor(undefined, 'reel')).toBeUndefined();
  });

  it('writes the warnings in English', () => {
    expect(warningText('metric_not_in_plan', brief(), ['reach', 'shares'])).toBe(
      "Success metric Saves is not one of this week's success metrics (Reach, Shares).",
    );
    expect(warningText({ code: 'no_references' }, brief(), undefined)).toBe(
      'No references. Claims in the script cannot be checked against sources.',
    );
  });

  it('names issue fields, including list positions', () => {
    expect(issueFieldName('references.2.url')).toEqual(['references', 2, 'url']);
    expect(issueLabel({ code: 'invalid_url', path: 'references.2.url', message: '' })).toBe(
      'References, reference 3 URL',
    );
    expect(issueLabel({ code: 'text_too_long', path: 'key_message', message: '' })).toBe('Key message');
  });

  it('shows who wrote a version and the domain of a reference', () => {
    expect(originText(brief())).toBe('AI');
    expect(originText(brief({ origin: 'human', created_by: { id: 2, name: 'Sara' } }))).toBe(
      'Edited by Sara',
    );
    expect(domainOf('https://www.example.org/a')).toBe('example.org');
    expect(domainOf('not a url')).toBe('not a url');
  });
});
