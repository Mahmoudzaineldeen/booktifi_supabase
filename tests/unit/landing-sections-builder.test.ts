import { describe, expect, it } from 'vitest';
import {
  normalizeSections,
  validateSections,
  duplicateSectionInList,
  type LandingSection,
} from '../../src/lib/landingSections';

describe('landing sections builder contracts', () => {
  it('keeps multiple FAQ items after normalization', () => {
    const sections = normalizeSections([
      {
        type: 'faq',
        order_index: 0,
        is_visible: true,
        content: {
          title: 'FAQ',
          faq_items: [
            { question: 'Q1', answer: 'A1' },
            { question: 'Q2', answer: 'A2' },
          ],
        },
      },
    ]);

    const faq = sections[0];
    expect(faq.type).toBe('faq');
    expect(Array.isArray((faq.content as any).faq_items)).toBe(true);
    expect((faq.content as any).faq_items).toHaveLength(2);
  });

  it('reorders sections deterministically by order_index', () => {
    const sections = normalizeSections([
      { type: 'cta', order_index: 3, is_visible: true, content: {} },
      { type: 'hero', order_index: 0, is_visible: true, content: { title: 'Hero' } },
      { type: 'services', order_index: 1, is_visible: true, content: {} },
    ]);

    expect(sections.map((s) => s.type)).toEqual(['hero', 'services', 'cta']);
    expect(sections.map((s) => s.order_index)).toEqual([0, 1, 2]);
  });

  it('supports hide/show without invalidating structure', () => {
    const sections = normalizeSections([
      { type: 'hero', order_index: 0, is_visible: false, content: { title: 'Hero' } },
      { type: 'services', order_index: 1, is_visible: true, content: {} },
    ]);

    const visible = sections.filter((s) => s.is_visible !== false);
    expect(visible).toHaveLength(1);
    expect(visible[0].type).toBe('services');
  });

  it('duplicates section with independent content copy', () => {
    const base: LandingSection[] = normalizeSections([
      {
        id: 'hero-1',
        type: 'hero',
        order_index: 0,
        is_visible: true,
        content: { title: 'Original Title', hero_images: ['a.png'] },
      },
      {
        id: 'faq-1',
        type: 'faq',
        order_index: 1,
        is_visible: true,
        content: { faq_items: [{ question: 'Q', answer: 'A' }] },
      },
    ]);

    const duplicated = duplicateSectionInList(base, 'hero-1');
    expect(duplicated).toHaveLength(3);
    expect(duplicated[1].type).toBe('hero');

    (duplicated[1].content as any).title = 'Changed in copy';
    expect((duplicated[0].content as any).title).toBe('Original Title');
  });

  it('validates required fields', () => {
    const invalid = normalizeSections([
      { type: 'hero', order_index: 0, is_visible: true, content: { title: '', title_ar: '' } },
      { type: 'faq', order_index: 1, is_visible: true, content: { faq_items: [] } },
    ]);

    const errors = validateSections(invalid);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
