import { describe, expect, it } from 'vitest';
import {
  normalizeSections,
  validateSection,
  sanitizeSection,
} from '../../server/src/lib/landingSections';

describe('server landing section validation', () => {
  it('rejects invalid faq payload', () => {
    const normalized = normalizeSections([
      { type: 'faq', order_index: 0, is_visible: true, content: { faq_items: [] } },
    ]);
    const errors = validateSection('faq', normalized[0].content || {});
    expect(errors.length).toBeGreaterThan(0);
  });

  it('sanitizes features items to valid cards only', () => {
    const content = sanitizeSection('features', {
      items: [
        { title: 'Card 1', description: 'Desc' },
        { title: '', description: 'Missing title' },
      ],
    });

    expect(Array.isArray((content as any).items)).toBe(true);
    expect((content as any).items).toHaveLength(1);
  });
});
