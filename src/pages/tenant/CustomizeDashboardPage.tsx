import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import { Eye, EyeOff, GripVertical, RotateCcw, Save } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { showNotification } from '../../contexts/NotificationContext';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import {
  DASHBOARD_WIDGET_DEFINITIONS,
  DashboardLayoutConfig,
  DashboardLayoutItem,
  getDefaultDashboardLayoutConfig,
  sanitizeDashboardLayoutConfig,
} from '../../lib/dashboardWidgets';
import { getDashboardLayout, resetDashboardLayout, saveDashboardLayout } from '../../lib/dashboardLayoutApi';

const SIZE_PRESETS = [
  { id: 'small', w: 4, h: 2, labelKey: 'dashboard.customize.widthSmall', fallback: 'Small' },
  { id: 'medium', w: 6, h: 3, labelKey: 'dashboard.customize.widthMedium', fallback: 'Medium' },
  { id: 'large', w: 12, h: 4, labelKey: 'dashboard.customize.widthLarge', fallback: 'Large' },
] as const;

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function packLayout(items: DashboardLayoutItem[]): DashboardLayoutItem[] {
  let currentX = 0;
  let currentY = 0;
  let rowHeight = 1;
  return items.map((item) => {
    const width = Math.max(1, Math.min(12, item.w));
    const height = Math.max(1, Math.min(8, item.h));
    if (currentX + width > 12) {
      currentX = 0;
      currentY += rowHeight;
      rowHeight = 1;
    }
    const packed = { ...item, x: currentX, y: currentY, w: width, h: height };
    currentX += width;
    rowHeight = Math.max(rowHeight, height);
    return packed;
  });
}

export function CustomizeDashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tenantSlug } = useParams<{ tenantSlug?: string }>();
  const { hasPermission } = useAuth();
  const [layout, setLayout] = useState<DashboardLayoutConfig>(getDefaultDashboardLayoutConfig());
  const [initialLayout, setInitialLayout] = useState<DashboardLayoutConfig>(getDefaultDashboardLayoutConfig());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canCustomize = hasPermission('customize_dashboard');

  useEffect(() => {
    if (!canCustomize) {
      setLoading(false);
      return;
    }
    let isActive = true;
    (async () => {
      try {
        const { layout: fetched } = await getDashboardLayout();
        if (!isActive) return;
        const sanitized = sanitizeDashboardLayoutConfig(fetched);
        setLayout(sanitized);
        setInitialLayout(sanitized);
      } catch (error: any) {
        if (!isActive) return;
        showNotification('error', error?.message || t('dashboard.customize.loadFailed', 'Failed to load layout.'));
      } finally {
        if (isActive) setLoading(false);
      }
    })();
    return () => {
      isActive = false;
    };
  }, [canCustomize, t]);

  const draftSignature = JSON.stringify(layout.widgets.map((w) => ({ id: w.id, w: w.w, h: w.h, visible: w.visible })));
  const initialSignature = JSON.stringify(initialLayout.widgets.map((w) => ({ id: w.id, w: w.w, h: w.h, visible: w.visible })));
  const hasChanges = draftSignature !== initialSignature;

  const widgetOrder = layout.widgets.map((w) => w.id);
  const widgetById = useMemo(() => new Map(layout.widgets.map((w) => [w.id, w])), [layout.widgets]);
  const previewLayout = useMemo(() => packLayout(layout.widgets.filter((w) => w.visible)), [layout.widgets]);
  const visibleCount = layout.widgets.filter((w) => w.visible).length;
  const hiddenCount = layout.widgets.length - visibleCount;

  function updateWidget(widgetId: string, partial: Partial<DashboardLayoutItem>) {
    setLayout((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) => (w.id === widgetId ? { ...w, ...partial } : w)),
    }));
  }

  function getWidgetPreset(widget: DashboardLayoutItem) {
    return SIZE_PRESETS.find((preset) => preset.w === widget.w && preset.h === widget.h)?.id ?? 'medium';
  }

  function applyPreset(widgetId: string, presetId: string) {
    const preset = SIZE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    updateWidget(widgetId, { w: preset.w, h: preset.h });
  }

  function onDragEnd(result: DropResult) {
    if (!result.destination) return;
    setLayout((prev) => ({
      ...prev,
      widgets: moveItem(prev.widgets, result.source.index, result.destination!.index),
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const nextConfig: DashboardLayoutConfig = {
        ...layout,
        widgets: packLayout(layout.widgets),
      };
      const saved = await saveDashboardLayout(nextConfig);
      const sanitized = sanitizeDashboardLayoutConfig(saved);
      setLayout(sanitized);
      setInitialLayout(sanitized);
      showNotification('success', t('dashboard.customize.saved', 'Dashboard layout saved.'));
    } catch (error: any) {
      showNotification('error', error?.message || t('dashboard.customize.saveFailed', 'Failed to save layout.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      const resetConfig = await resetDashboardLayout();
      const sanitized = sanitizeDashboardLayoutConfig(resetConfig);
      setLayout(sanitized);
      setInitialLayout(sanitized);
      showNotification('success', t('dashboard.customize.resetDone', 'Dashboard reset to default.'));
    } catch (error: any) {
      showNotification('error', error?.message || t('dashboard.customize.resetFailed', 'Failed to reset layout.'));
    } finally {
      setSaving(false);
    }
  }

  function handleLivePreview() {
    const packedDraft = sanitizeDashboardLayoutConfig({
      ...layout,
      widgets: packLayout(layout.widgets),
    });
    sessionStorage.setItem('dashboard_layout_preview_draft', JSON.stringify(packedDraft));
    const previewUrl = tenantSlug ? `/${tenantSlug}/admin?layoutPreview=1` : '/';
    window.open(previewUrl, '_blank', 'noopener,noreferrer');
  }

  if (!canCustomize) {
    return (
      <div className="p-6 md:p-8">
        <Card>
          <CardContent className="p-6 space-y-4">
            <h1 className="text-xl font-semibold text-gray-900">{t('common.notAuthorized', 'Not authorized')}</h1>
            <p className="text-sm text-gray-600">
              {t('dashboard.customize.permissionRequired', 'You need dashboard customization permission to access this page.')}
            </p>
            <Button onClick={() => navigate(tenantSlug ? `/${tenantSlug}/admin` : '/')} variant="secondary">
              {t('dashboard.customize.backToDashboard', 'Back to dashboard')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-12 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('dashboard.customize.title', 'Customize Dashboard')}</h1>
          <p className="text-sm text-gray-600">
            {t('dashboard.customize.subtitle', 'Reorder widgets, toggle visibility, and adjust widget sizes.')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            onClick={() => setLayout((prev) => ({ ...prev, widgets: prev.widgets.map((w) => ({ ...w, visible: true })) }))}
            disabled={saving || hiddenCount === 0}
          >
            {t('common.show', 'Show')} {t('dashboard.customize.widgets', 'Widgets')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setLayout((prev) => ({ ...prev, widgets: prev.widgets.map((w) => ({ ...w, visible: false })) }))}
            disabled={saving || visibleCount === 0}
          >
            {t('common.hide', 'Hide')} {t('dashboard.customize.widgets', 'Widgets')}
          </Button>
          <Button variant="secondary" onClick={handleLivePreview}>
            {t('dashboard.customize.previewLive', 'Live Preview')}
          </Button>
          <Button variant="outline" onClick={handleReset} disabled={saving} icon={<RotateCcw className="w-4 h-4" />}>
            {t('dashboard.customize.reset', 'Reset')}
          </Button>
          <Button onClick={handleSave} disabled={saving || !hasChanges} loading={saving} icon={<Save className="w-4 h-4" />}>
            {t('common.save', 'Save')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs text-gray-500">{t('dashboard.customize.widgets', 'Widgets')}</p>
          <p className="text-lg font-semibold text-gray-900">{layout.widgets.length}</p>
        </div>
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-xs text-green-700">{t('common.show', 'Show')}</p>
          <p className="text-lg font-semibold text-green-800">{visibleCount}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-700">{t('common.hide', 'Hide')}</p>
          <p className="text-lg font-semibold text-amber-800">{hiddenCount}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[24rem_minmax(0,1fr)] gap-6">
        <Card>
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">{t('dashboard.customize.widgets', 'Widgets')}</h2>
            <p className="text-xs text-gray-500 mb-3">
              {t('dashboard.customize.helper', 'Drag to reorder. Toggle to show/hide. Choose size preset.')}
            </p>
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="dashboard-widgets">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="space-y-2 max-h-[70vh] overflow-y-auto pr-1"
                  >
                    {widgetOrder.map((widgetId, index) => {
                      const definition = DASHBOARD_WIDGET_DEFINITIONS.find((d) => d.id === widgetId);
                      if (!definition) return null;
                      const widget = widgetById.get(widgetId)!;
                      return (
                        <Draggable key={widgetId} draggableId={widgetId} index={index}>
                          {(dragProvided) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={`rounded-lg border p-3 transition-colors ${
                                widget.visible ? 'border-gray-200 bg-white' : 'border-amber-200 bg-amber-50'
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  className="mt-0.5 text-gray-400 hover:text-gray-600"
                                  {...dragProvided.dragHandleProps}
                                >
                                  <GripVertical className="w-4 h-4" />
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-medium text-gray-900">
                                        {t(definition.nameKey, definition.fallbackName)}
                                      </p>
                                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                                        {t(definition.descriptionKey, definition.fallbackDescription)}
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => updateWidget(widgetId, { visible: !widget.visible })}
                                      className="text-gray-500 hover:text-gray-700"
                                      title={widget.visible ? t('common.hide', 'Hide') : t('common.show', 'Show')}
                                    >
                                      {widget.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                    </button>
                                  </div>
                                  <div className="mt-3">
                                    <label className="text-xs text-gray-600 block mb-1">
                                      {t('dashboard.customize.width', 'Width')}
                                    </label>
                                    <div className="flex gap-1 flex-wrap">
                                      {SIZE_PRESETS.map((preset) => {
                                        const active = getWidgetPreset(widget) === preset.id;
                                        return (
                                          <button
                                            key={preset.id}
                                            type="button"
                                            onClick={() => applyPreset(widgetId, preset.id)}
                                            className={`px-2.5 py-1 text-xs rounded-md border ${
                                              active
                                                ? 'bg-blue-50 border-blue-300 text-blue-700'
                                                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                                            }`}
                                          >
                                            {t(preset.labelKey, preset.fallback)}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
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

        <Card>
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">{t('dashboard.customize.preview', 'Preview')}</h2>
            {previewLayout.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                {t('dashboard.customize.emptyPreview', 'All widgets are hidden. Enable at least one widget to preview.')}
              </div>
            ) : (
              <div className="grid grid-cols-12 gap-3">
                {previewLayout.map((widget) => {
                  const definition = DASHBOARD_WIDGET_DEFINITIONS.find((d) => d.id === widget.id);
                  if (!definition) return null;
                  return (
                    <div
                      key={widget.id}
                      className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3"
                      style={{ gridColumn: `span ${widget.w} / span ${widget.w}` }}
                    >
                      <p className="text-sm font-medium text-gray-900">{t(definition.nameKey, definition.fallbackName)}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {t('dashboard.customize.previewSize', '{{w}}/12 width', { w: widget.w })}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
