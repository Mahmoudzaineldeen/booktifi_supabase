import React, { useEffect, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { showNotification } from '../../contexts/NotificationContext';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Eye, GripVertical, Plus, Save, Trash2, Copy, EyeOff, Eye as EyeIcon } from 'lucide-react';
import { fetchAdminLandingPage, saveAdminLandingPage, duplicateAdminLandingSection } from '../../lib/landingBuilderApi';
import {
  LANDING_SECTION_TYPES,
  type LandingSection,
  type LandingSectionType,
  type LandingTemplateId,
  LANDING_TEMPLATE_IDS,
  normalizeSections,
  defaultSectionContent,
  validateSections,
  duplicateSectionInList,
  createSectionsFromTemplate,
} from '../../lib/landingSections';
import { LandingSectionsRenderer } from '../../components/landing/LandingSectionsRenderer';
import { useTenantFeatures } from '../../hooks/useTenantFeatures';

type CustomLandingTemplate = {
  id: string;
  name: string;
  sections: LandingSection[];
  primaryColor: string;
  secondaryColor: string;
};

function sectionLabel(type: LandingSectionType, t: (k: string, d?: string) => string) {
  const map: Record<LandingSectionType, string> = {
    hero: t('landingPage.heroSection', 'Hero'),
    features: t('landingPage.featuresSection', 'Features'),
    advantages: t('landingPage.advantagesSection', 'Advantages'),
    stats: t('landingPage.statsSection', 'Stats'),
    faq: t('landingPage.faqSection', 'FAQ'),
    services: t('landingPage.servicesSection', 'Services'),
    packages: t('landingPage.packagesSection', 'Packages'),
    partners: t('landingPage.partnersSection', 'Partners'),
    cta: t('landingPage.ctaSection', 'CTA'),
    footer: t('landingPage.footerSection', 'Footer'),
  };
  return map[type];
}

function move<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function normalizeOrder(sections: LandingSection[]): LandingSection[] {
  return sections.map((section, index) => ({ ...section, order_index: index }));
}

export function LandingPageBuilder() {
  const { t, i18n } = useTranslation();
  const { userProfile, tenant } = useAuth();
  const { features: tenantFeatures } = useTenantFeatures(userProfile?.tenant_id);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageId, setPageId] = useState<string>('');
  const [pageName, setPageName] = useState('Main Landing Page');
  const [sections, setSections] = useState<LandingSection[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string>('');
  const [sectionToAdd, setSectionToAdd] = useState<LandingSectionType>('hero');
  const [templateToApply, setTemplateToApply] = useState<string>('default');
  const [templatePrimaryColor, setTemplatePrimaryColor] = useState('#2563eb');
  const [templateSecondaryColor, setTemplateSecondaryColor] = useState('#3b82f6');
  const [customTemplateName, setCustomTemplateName] = useState('');
  const [customTemplates, setCustomTemplates] = useState<CustomLandingTemplate[]>([]);

  const selectedSection = useMemo(
    () => sections.find((section) => (section.id || `${section.type}-${section.order_index}`) === selectedSectionId) || null,
    [sections, selectedSectionId]
  );

  useEffect(() => {
    if (!userProfile?.tenant_id) return;
    void loadPage();
  }, [userProfile?.tenant_id]);

  useEffect(() => {
    if (!userProfile?.tenant_id) return;
    const storageKey = `landing_custom_templates:${userProfile.tenant_id}`;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setCustomTemplates([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setCustomTemplates([]);
        return;
      }
      const normalized = parsed
        .map((row) => {
          if (!row || typeof row !== 'object') return null;
          const candidate = row as Record<string, unknown>;
          const id = typeof candidate.id === 'string' ? candidate.id : '';
          const name = typeof candidate.name === 'string' ? candidate.name : '';
          const sectionsRaw = normalizeSections(candidate.sections);
          if (!id || !name || sectionsRaw.length === 0) return null;
          return {
            id,
            name,
            sections: sectionsRaw,
            primaryColor: typeof candidate.primaryColor === 'string' ? candidate.primaryColor : '#2563eb',
            secondaryColor: typeof candidate.secondaryColor === 'string' ? candidate.secondaryColor : '#3b82f6',
          } as CustomLandingTemplate;
        })
        .filter((row): row is CustomLandingTemplate => !!row);
      setCustomTemplates(normalized);
    } catch {
      setCustomTemplates([]);
    }
  }, [userProfile?.tenant_id]);

  useEffect(() => {
    if (!userProfile?.tenant_id) return;
    const storageKey = `landing_custom_templates:${userProfile.tenant_id}`;
    localStorage.setItem(storageKey, JSON.stringify(customTemplates));
  }, [customTemplates, userProfile?.tenant_id]);

  async function loadPage() {
    if (!userProfile?.tenant_id) return;
    setLoading(true);
    try {
      const page = await fetchAdminLandingPage(userProfile.tenant_id);
      setPageId(page.id);
      setPageName(page.name || 'Main Landing Page');
      const normalized = normalizeSections(page.sections);
      setSections(normalized);
      const heroSection = normalized.find((row) => row.type === 'hero');
      if (heroSection) {
        const primary = typeof heroSection.content?.primary_color === 'string' ? String(heroSection.content.primary_color) : '';
        const secondary = typeof heroSection.content?.secondary_color === 'string' ? String(heroSection.content.secondary_color) : '';
        if (primary) setTemplatePrimaryColor(primary);
        if (secondary) setTemplateSecondaryColor(secondary);
      }
      if (normalized.length > 0) {
        setSelectedSectionId(normalized[0].id || `${normalized[0].type}-${normalized[0].order_index}`);
      }
    } catch (error: any) {
      showNotification('error', error.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  }

  function updateSection(sectionId: string, updater: (section: LandingSection) => LandingSection) {
    setSections((prev) =>
      normalizeOrder(
        prev.map((section) => {
          const key = section.id || `${section.type}-${section.order_index}`;
          return key === sectionId ? updater(section) : section;
        })
      )
    );
  }

  function cloneSections(input: LandingSection[]): LandingSection[] {
    return normalizeSections(JSON.parse(JSON.stringify(input)));
  }

  function applyThemeColors(input: LandingSection[], primaryColor: string, secondaryColor: string): LandingSection[] {
    return normalizeOrder(
      input.map((section) => {
        if (section.type !== 'hero') return section;
        return {
          ...section,
          content: {
            ...(section.content || {}),
            primary_color: primaryColor,
            secondary_color: secondaryColor,
          },
        };
      })
    );
  }

  function addSection() {
    const newSection: LandingSection = {
      type: sectionToAdd,
      order_index: sections.length,
      is_visible: true,
      content: defaultSectionContent(sectionToAdd),
    };
    const next = normalizeOrder([...sections, newSection]);
    setSections(next);
    setSelectedSectionId(`${newSection.type}-${newSection.order_index}`);
  }

  function applyTemplate(templateId: string) {
    const customTemplate = customTemplates.find((row) => row.id === templateId);
    const baseSections = customTemplate
      ? cloneSections(customTemplate.sections)
      : createSectionsFromTemplate(templateId as LandingTemplateId);
    const next = applyThemeColors(
      normalizeOrder(baseSections),
      templatePrimaryColor,
      templateSecondaryColor
    );
    setSections(next);
    if (next.length > 0) {
      setSelectedSectionId(next[0].id || `${next[0].type}-${next[0].order_index}`);
    }
    showNotification('success', t('landingPage.templateApplied', 'Template applied'));
  }

  function saveCurrentAsCustomTemplate() {
    const trimmedName = customTemplateName.trim();
    if (!trimmedName) {
      showNotification('warning', t('landingPage.templateNameRequired', 'Template name is required'));
      return;
    }
    const id = `custom-${Date.now()}`;
    const normalized = applyThemeColors(cloneSections(sections), templatePrimaryColor, templateSecondaryColor);
    if (normalized.length === 0) {
      showNotification('warning', t('landingPage.addSectionFirst', 'Add at least one section first'));
      return;
    }
    const nextTemplate: CustomLandingTemplate = {
      id,
      name: trimmedName,
      sections: normalized,
      primaryColor: templatePrimaryColor,
      secondaryColor: templateSecondaryColor,
    };
    setCustomTemplates((prev) => [nextTemplate, ...prev].slice(0, 20));
    setTemplateToApply(id);
    setCustomTemplateName('');
    showNotification('success', t('landingPage.customTemplateSaved', 'Custom template saved'));
  }

  function removeCustomTemplate(templateId: string) {
    setCustomTemplates((prev) => prev.filter((row) => row.id !== templateId));
    if (templateToApply === templateId) {
      setTemplateToApply('default');
    }
    showNotification('success', t('common.deleted', 'Deleted'));
  }

  function removeSection(sectionId: string) {
    const next = normalizeOrder(
      sections.filter((section) => (section.id || `${section.type}-${section.order_index}`) !== sectionId)
    );
    setSections(next);
    if (next.length > 0) {
      setSelectedSectionId(next[0].id || `${next[0].type}-${next[0].order_index}`);
    } else {
      setSelectedSectionId('');
    }
  }

  async function duplicateSection(sectionId: string) {
    if (!userProfile?.tenant_id || !pageId) return;
    const source = sections.find((section) => (section.id || `${section.type}-${section.order_index}`) === sectionId);
    if (!source) return;

    if (source.id) {
      try {
        const duplicated = await duplicateAdminLandingSection({
          tenantId: userProfile.tenant_id,
          pageId,
          sectionId: source.id,
        });
        setSections(normalizeSections(duplicated));
        showNotification('success', t('common.duplicated', 'Duplicated'));
        return;
      } catch {
        // fallback to client duplication below
      }
    }

    const index = sections.findIndex((section) => (section.id || `${section.type}-${section.order_index}`) === sectionId);
    if (index < 0) return;
    setSections(duplicateSectionInList(sections, sectionId));
    showNotification('success', t('common.duplicated', 'Duplicated'));
  }

  function onDragEnd(result: DropResult) {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;
    setSections((prev) => normalizeOrder(move(prev, result.source.index, result.destination!.index)));
  }

  async function handleSave() {
    if (!userProfile?.tenant_id) return;
    const normalized = normalizeOrder(sections);
    const validationErrors = validateSections(normalized);
    if (validationErrors.length > 0) {
      showNotification('warning', validationErrors[0]);
      return;
    }

    setSaving(true);
    try {
      const page = await saveAdminLandingPage(userProfile.tenant_id, {
        name: pageName.trim() || 'Main Landing Page',
        sections: normalized,
      });
      setPageId(page.id);
      setSections(normalizeSections(page.sections));
      showNotification('success', t('landingPage.savedSuccessfully', 'Saved successfully'));
    } catch (error: any) {
      showNotification('error', error.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  function handlePreview() {
    if (!tenant?.slug) return;
      window.open(`/${tenant.slug}/book`, '_blank');
  }

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
      </div>
    );
  }

  const pageTitle = t('landingPage.title', { defaultValue: 'Website Builder' });
  const pageSubtitle = t('landingPage.subtitle', { defaultValue: 'Customize your public booking page' });

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{pageTitle}</h1>
          <p className="text-sm md:text-base text-gray-600 mt-1">{pageSubtitle}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" icon={<Eye className="w-4 h-4" />} onClick={handlePreview}>
            {t('landingPage.preview', 'Preview')}
          </Button>
          <Button icon={<Save className="w-4 h-4" />} onClick={handleSave} disabled={saving}>
            {saving ? t('landingPage.saving', 'Saving...') : t('landingPage.saveChanges', 'Save changes')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <Card className="h-fit">
          <CardHeader className="space-y-3">
            <CardTitle>{t('landingPage.builderSections', 'Sections')}</CardTitle>
            <Input
              label={t('landingPage.pageName', 'Page name')}
              value={pageName}
              onChange={(e) => setPageName(e.target.value)}
            />
            <div className="flex gap-2">
              <select
                value={sectionToAdd}
                onChange={(e) => setSectionToAdd(e.target.value as LandingSectionType)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {LANDING_SECTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {sectionLabel(type, t as any)}
                  </option>
                ))}
              </select>
              <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={addSection}>
                {t('common.add', 'Add')}
              </Button>
            </div>
            <div className="flex gap-2">
              <select
                value={templateToApply}
                onChange={(e) => setTemplateToApply(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {LANDING_TEMPLATE_IDS.map((templateId) => (
                  <option key={templateId} value={templateId}>
                    {templateId === 'default'
                      ? t('landingPage.templateDefault', 'Default template')
                      : templateId === 'conversion'
                        ? t('landingPage.templateConversion', 'Conversion template')
                        : t('landingPage.templateMinimal', 'Minimal template')}
                  </option>
                ))}
                {customTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="secondary" onClick={() => applyTemplate(templateToApply)}>
                {t('landingPage.applyTemplate', 'Apply')}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-600">
                {t('landingPage.primaryColor', 'Primary color')}
                <input
                  type="color"
                  value={templatePrimaryColor}
                  onChange={(e) => setTemplatePrimaryColor(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-300 p-1"
                />
              </label>
              <label className="text-xs text-gray-600">
                {t('landingPage.secondaryColor', 'Secondary color')}
                <input
                  type="color"
                  value={templateSecondaryColor}
                  onChange={(e) => setTemplateSecondaryColor(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-300 p-1"
                />
              </label>
            </div>
            <div className="flex gap-2">
              <Input
                value={customTemplateName}
                onChange={(e) => setCustomTemplateName(e.target.value)}
                placeholder={t('landingPage.customTemplateName', 'My custom template')}
              />
              <Button size="sm" variant="secondary" onClick={saveCurrentAsCustomTemplate}>
                {t('landingPage.saveTemplate', 'Save')}
              </Button>
            </div>
            {templateToApply.startsWith('custom-') && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => removeCustomTemplate(templateToApply)}
                className="w-full"
              >
                {t('landingPage.deleteTemplate', 'Delete selected custom template')}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="landing-sections">
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                    {sections.map((section, index) => {
                      const sectionId = section.id || `${section.type}-${section.order_index}`;
                      const isSelected = sectionId === selectedSectionId;
                      return (
                        <Draggable draggableId={sectionId} index={index} key={sectionId}>
                          {(dragProvided) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={`rounded-lg border p-2.5 ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'}`}
                            >
                              <div className="flex items-center gap-2">
                      <button
                        type="button"
                                  className="text-gray-500 hover:text-gray-700"
                                  {...dragProvided.dragHandleProps}
                                  aria-label={t('common.drag', 'Drag')}
                      >
                                  <GripVertical className="w-4 h-4" />
                      </button>
                <button
                  type="button"
                                  className="flex-1 text-start font-medium text-sm"
                                  onClick={() => setSelectedSectionId(sectionId)}
                                >
                                  {sectionLabel(section.type, t as any)}
                </button>
                <button
                  type="button"
                                  className="text-gray-500 hover:text-gray-700"
                                  onClick={() => updateSection(sectionId, (curr) => ({ ...curr, is_visible: !curr.is_visible }))}
                                  title={section.is_visible ? t('common.hide', 'Hide') : t('common.show', 'Show')}
                                >
                                  {section.is_visible ? <EyeIcon className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                      <button
                        type="button"
                                  className="text-gray-500 hover:text-gray-700"
                                  onClick={() => void duplicateSection(sectionId)}
                                  title={t('common.duplicate', 'Duplicate')}
                      >
                                  <Copy className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                                  className="text-red-500 hover:text-red-700"
                                  onClick={() => removeSection(sectionId)}
                                  title={t('common.delete', 'Delete')}
                                >
                                  <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                </div>
              )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
            </div>
                )}
              </Droppable>
            </DragDropContext>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t('landingPage.sectionEditor', 'Section editor')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedSection ? (
              <p className="text-sm text-gray-500">{t('landingPage.selectSectionToEdit', 'Select a section to edit')}</p>
            ) : (
              <SectionEditor
                section={selectedSection}
                language={i18n.language}
                onUploadDataUrl={fileToDataUrl}
                onChange={(content) => {
                  const sectionId = selectedSection.id || `${selectedSection.type}-${selectedSection.order_index}`;
                  updateSection(sectionId, (curr) => ({ ...curr, content }));
                }}
              />
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t('landingPage.livePreview', 'Live preview')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <LandingSectionsRenderer
              sections={sections}
              language={i18n.language}
              tenantName={tenant?.name || 'Tenant'}
              tenantNameAr={tenant?.name_ar}
              services={[]}
              packages={[]}
              packagesEnabled={tenantFeatures?.packages_enabled ?? true}
              previewMode
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SectionEditor({
  section,
  language,
  onUploadDataUrl,
  onChange,
}: {
  section: LandingSection;
  language: string;
  onUploadDataUrl: (file: File) => Promise<string>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const content = section.content || {};
  const setValue = (key: string, value: unknown) => onChange({ ...content, [key]: value });
  const twoCol = 'grid grid-cols-1 md:grid-cols-2 gap-3';

  if (section.type === 'hero') {
    return (
      <>
        <div className={twoCol}>
          <Input label="Title (EN)" value={String(content.title || '')} onChange={(e) => setValue('title', e.target.value)} />
          <Input label="Title (AR)" value={String(content.title_ar || '')} onChange={(e) => setValue('title_ar', e.target.value)} />
        </div>
        <div className={twoCol}>
          <Input label="Subtitle (EN)" value={String(content.subtitle || '')} onChange={(e) => setValue('subtitle', e.target.value)} />
          <Input label="Subtitle (AR)" value={String(content.subtitle_ar || '')} onChange={(e) => setValue('subtitle_ar', e.target.value)} />
        </div>
        <Input label="Hero image URL" value={String(content.hero_image_url || '')} onChange={(e) => setValue('hero_image_url', e.target.value)} />
                <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Upload hero image</label>
                  <input
                    type="file"
            accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
              const dataUrl = await onUploadDataUrl(file);
              setValue('hero_image_url', dataUrl);
            }}
            className="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-sm"
          />
                    </div>
        <Input label="Hero video URL" value={String(content.hero_video_url || '')} onChange={(e) => setValue('hero_video_url', e.target.value)} />
        <div className={twoCol}>
          <Input label="Primary color" value={String(content.primary_color || '#2563eb')} onChange={(e) => setValue('primary_color', e.target.value)} />
          <Input label="Secondary color" value={String(content.secondary_color || '#3b82f6')} onChange={(e) => setValue('secondary_color', e.target.value)} />
                </div>
                <textarea
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
          rows={3}
          value={Array.isArray(content.hero_images) ? content.hero_images.join('\n') : ''}
          onChange={(e) => setValue('hero_images', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))}
          placeholder="Hero images URLs (one per line)"
        />
              <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Upload carousel images</label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              if (files.length === 0) return;
              const uploaded = await Promise.all(files.map((file) => onUploadDataUrl(file)));
              const current = Array.isArray(content.hero_images) ? content.hero_images : [];
              setValue('hero_images', [...current, ...uploaded]);
            }}
            className="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-sm"
                />
              </div>
      </>
    );
  }

  if (section.type === 'faq') {
    const faqItems = Array.isArray(content.faq_items) ? content.faq_items : [];
    return (
      <>
        <div className={twoCol}>
          <Input label="Title (EN)" value={String(content.title || '')} onChange={(e) => setValue('title', e.target.value)} />
          <Input label="Title (AR)" value={String(content.title_ar || '')} onChange={(e) => setValue('title_ar', e.target.value)} />
                </div>
        {faqItems.map((item: any, index: number) => (
          <div key={`faq-${index}`} className="rounded-lg border border-gray-200 p-3 space-y-2">
            <div className="flex justify-between items-center">
              <p className="text-sm font-medium">FAQ #{index + 1}</p>
              <button
                type="button"
                className="text-red-600 text-sm"
                onClick={() => {
                  const next = [...faqItems];
                  next.splice(index, 1);
                  setValue('faq_items', next);
                }}
              >
                Remove
              </button>
              </div>
            <div className={twoCol}>
              <Input
                label="Question (EN)"
                value={String(item?.question || '')}
                onChange={(e) => {
                  const next = [...faqItems];
                  next[index] = { ...(next[index] || {}), question: e.target.value };
                  setValue('faq_items', next);
                }}
                  />
                  <Input
                label="Question (AR)"
                value={String(item?.question_ar || '')}
                onChange={(e) => {
                  const next = [...faqItems];
                  next[index] = { ...(next[index] || {}), question_ar: e.target.value };
                  setValue('faq_items', next);
                }}
                  />
                </div>
            <div className={twoCol}>
              <textarea
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                rows={2}
                value={String(item?.answer || '')}
                onChange={(e) => {
                  const next = [...faqItems];
                  next[index] = { ...(next[index] || {}), answer: e.target.value };
                  setValue('faq_items', next);
                }}
                placeholder="Answer (EN)"
              />
              <textarea
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                rows={2}
                value={String(item?.answer_ar || '')}
                onChange={(e) => {
                  const next = [...faqItems];
                  next[index] = { ...(next[index] || {}), answer_ar: e.target.value };
                  setValue('faq_items', next);
                }}
                placeholder="Answer (AR)"
              />
            </div>
          </div>
        ))}
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => setValue('faq_items', [...faqItems, { question: '', question_ar: '', answer: '', answer_ar: '' }])}
        >
          Add FAQ item
        </Button>
      </>
    );
  }

  if (section.type === 'features' || section.type === 'advantages' || section.type === 'stats') {
    const items = Array.isArray(content.items) ? content.items : [];
    return (
      <>
        <div className={twoCol}>
          <Input label="Title (EN)" value={String(content.title || '')} onChange={(e) => setValue('title', e.target.value)} />
          <Input label="Title (AR)" value={String(content.title_ar || '')} onChange={(e) => setValue('title_ar', e.target.value)} />
        </div>
        {items.map((item: any, index: number) => (
          <div key={`${section.type}-item-${index}`} className="rounded-lg border border-gray-200 p-3 space-y-2">
                  <div className="flex justify-between items-center">
              <p className="text-sm font-medium">Item #{index + 1}</p>
                    <button
                      type="button"
                className="text-red-600 text-sm"
                      onClick={() => {
                  const next = [...items];
                  next.splice(index, 1);
                  setValue('items', next);
                }}
              >
                Remove
                    </button>
                  </div>
            <div className={twoCol}>
                    <Input
                label="Title (EN)"
                value={String(item?.title || '')}
                      onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...(next[index] || {}), title: e.target.value };
                  setValue('items', next);
                      }}
                    />
                    <Input
                label="Title (AR)"
                value={String(item?.title_ar || '')}
                      onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...(next[index] || {}), title_ar: e.target.value };
                  setValue('items', next);
                      }}
                    />
                  </div>
            <div className={twoCol}>
                      <textarea
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                rows={2}
                value={String(item?.description || '')}
                        onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...(next[index] || {}), description: e.target.value };
                  setValue('items', next);
                }}
                placeholder="Description (EN)"
              />
                      <textarea
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                rows={2}
                value={String(item?.description_ar || '')}
                        onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...(next[index] || {}), description_ar: e.target.value };
                  setValue('items', next);
                }}
                placeholder="Description (AR)"
                      />
                    </div>
            <div className={twoCol}>
              <Input
                label="Icon (optional)"
                value={String(item?.icon || '')}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...(next[index] || {}), icon: e.target.value };
                  setValue('items', next);
                }}
              />
              {section.type === 'stats' ? (
                <Input
                  label="Value"
                  value={String(item?.value || '')}
                  onChange={(e) => {
                    const next = [...items];
                    next[index] = { ...(next[index] || {}), value: e.target.value };
                    setValue('items', next);
                  }}
                />
              ) : (
                <div />
              )}
                  </div>
                </div>
              ))}
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => setValue('items', [...items, { icon: '', title: '', title_ar: '', description: '', description_ar: '' }])}
        >
          Add item
        </Button>
      </>
    );
  }

  if (section.type === 'services') {
    return (
      <>
        <div className={twoCol}>
          <Input label="Title (EN)" value={String(content.title || '')} onChange={(e) => setValue('title', e.target.value)} />
          <Input label="Title (AR)" value={String(content.title_ar || '')} onChange={(e) => setValue('title_ar', e.target.value)} />
        </div>
        <div className={twoCol}>
          <Input label="Subtitle (EN)" value={String(content.subtitle || '')} onChange={(e) => setValue('subtitle', e.target.value)} />
          <Input label="Subtitle (AR)" value={String(content.subtitle_ar || '')} onChange={(e) => setValue('subtitle_ar', e.target.value)} />
        </div>
        <div className={twoCol}>
          <Input
            label="Perk 1 text (EN)"
            value={String(content.book_now_pay_later_text || '')}
            onChange={(e) => setValue('book_now_pay_later_text', e.target.value)}
            placeholder="Book now, pay later"
          />
          <Input
            label="Perk 1 text (AR)"
            value={String(content.book_now_pay_later_text_ar || '')}
            onChange={(e) => setValue('book_now_pay_later_text_ar', e.target.value)}
            placeholder="احجز الآن وادفع لاحقاً"
          />
        </div>
        <div className={twoCol}>
          <Input
            label="Perk 2 text (EN)"
            value={String(content.flexible_duration_text || '')}
            onChange={(e) => setValue('flexible_duration_text', e.target.value)}
            placeholder="Flexible duration"
          />
          <Input
            label="Perk 2 text (AR)"
            value={String(content.flexible_duration_text_ar || '')}
            onChange={(e) => setValue('flexible_duration_text_ar', e.target.value)}
            placeholder="مدة مرنة"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={content.enable_search !== false}
            onChange={(e) => setValue('enable_search', e.target.checked)}
          />
          Enable service search
              </label>
      </>
    );
  }

  if (section.type === 'packages') {
    return (
      <>
        <div className={twoCol}>
          <Input label="Title (EN)" value={String(content.title || '')} onChange={(e) => setValue('title', e.target.value)} />
          <Input label="Title (AR)" value={String(content.title_ar || '')} onChange={(e) => setValue('title_ar', e.target.value)} />
        </div>
        <div className={twoCol}>
          <Input label="Subtitle (EN)" value={String(content.subtitle || '')} onChange={(e) => setValue('subtitle', e.target.value)} />
          <Input label="Subtitle (AR)" value={String(content.subtitle_ar || '')} onChange={(e) => setValue('subtitle_ar', e.target.value)} />
        </div>
        <p className="text-xs text-gray-500">
          Packages are loaded from your catalog. Ensure Packages are enabled under tenant features.
        </p>
      </>
    );
  }

  if (section.type === 'partners') {
    const logos = Array.isArray(content.logos) ? content.logos : [];
    return (
      <>
        <div className={twoCol}>
          <Input label="Title (EN)" value={String(content.title || '')} onChange={(e) => setValue('title', e.target.value)} />
          <Input label="Title (AR)" value={String(content.title_ar || '')} onChange={(e) => setValue('title_ar', e.target.value)} />
        </div>
              <textarea
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
          rows={4}
          value={logos.join('\n')}
          onChange={(e) => setValue('logos', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))}
          placeholder="Partner logo URLs (one per line)"
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Upload partner logos</label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              if (files.length === 0) return;
              const uploaded = await Promise.all(files.map((file) => onUploadDataUrl(file)));
              setValue('logos', [...logos, ...uploaded]);
            }}
            className="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-sm"
              />
            </div>
      </>
    );
  }

  if (section.type === 'cta') {
    return (
      <>
        <div className={twoCol}>
          <Input label="Title (EN)" value={String(content.title || '')} onChange={(e) => setValue('title', e.target.value)} />
          <Input label="Title (AR)" value={String(content.title_ar || '')} onChange={(e) => setValue('title_ar', e.target.value)} />
          </div>
        <div className={twoCol}>
          <Input label="Subtitle (EN)" value={String(content.subtitle || '')} onChange={(e) => setValue('subtitle', e.target.value)} />
          <Input label="Subtitle (AR)" value={String(content.subtitle_ar || '')} onChange={(e) => setValue('subtitle_ar', e.target.value)} />
        </div>
        <div className={twoCol}>
          <Input label="Button label (EN)" value={String(content.button_label || '')} onChange={(e) => setValue('button_label', e.target.value)} />
          <Input label="Button label (AR)" value={String(content.button_label_ar || '')} onChange={(e) => setValue('button_label_ar', e.target.value)} />
      </div>
        <Input label="Button target" value={String(content.button_target || '#services')} onChange={(e) => setValue('button_target', e.target.value)} />
      </>
    );
  }

  if (section.type === 'footer') {
    return (
      <>
        <div className={twoCol}>
          <Input label="About title (EN)" value={String(content.about_title || '')} onChange={(e) => setValue('about_title', e.target.value)} />
          <Input label="About title (AR)" value={String(content.about_title_ar || '')} onChange={(e) => setValue('about_title_ar', e.target.value)} />
        </div>
        <div className={twoCol}>
          <textarea
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
            rows={3}
            value={String(content.about_description || '')}
            onChange={(e) => setValue('about_description', e.target.value)}
            placeholder="About description (EN)"
          />
          <textarea
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
            rows={3}
            value={String(content.about_description_ar || '')}
            onChange={(e) => setValue('about_description_ar', e.target.value)}
            placeholder="About description (AR)"
          />
        </div>
        <div className={twoCol}>
          <Input label="Contact email" value={String(content.contact_email || '')} onChange={(e) => setValue('contact_email', e.target.value)} />
          <Input label="Contact phone" value={String(content.contact_phone || '')} onChange={(e) => setValue('contact_phone', e.target.value)} />
        </div>
        <div className={twoCol}>
          <Input label="Facebook URL" value={String(content.social_facebook || '')} onChange={(e) => setValue('social_facebook', e.target.value)} />
          <Input label="Twitter URL" value={String(content.social_twitter || '')} onChange={(e) => setValue('social_twitter', e.target.value)} />
        </div>
        <Input label="Instagram URL" value={String(content.social_instagram || '')} onChange={(e) => setValue('social_instagram', e.target.value)} />
      </>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Raw section content ({language})</p>
      <textarea
        className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
        rows={10}
        value={JSON.stringify(content, null, 2)}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            // ignore invalid JSON while typing
          }
        }}
      />
    </div>
  );
}
