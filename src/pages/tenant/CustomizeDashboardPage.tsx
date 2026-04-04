import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';
import { Eye, EyeOff, GripVertical, RotateCcw, Save, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { showNotification } from '../../contexts/NotificationContext';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import {
  DASHBOARD_WIDGET_DEFINITIONS,
  DashboardLayoutConfig,
  DashboardLayoutItem,
  getDashboardWidgetMinHeightRows,
  getDefaultDashboardLayoutConfig,
  sanitizeDashboardLayoutConfig,
} from '../../lib/dashboardWidgets';
import {
  DashboardProfile,
  getDashboardLayout,
  getDashboardProfiles,
  resetDashboardLayout,
  saveDashboardLayout,
} from '../../lib/dashboardLayoutApi';

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

export function CustomizeDashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tenantSlug } = useParams<{ tenantSlug?: string }>();
  const { hasPermission } = useAuth();
  const [layout, setLayout] = useState<DashboardLayoutConfig>(getDefaultDashboardLayoutConfig());
  const [initialLayout, setInitialLayout] = useState<DashboardLayoutConfig>(getDefaultDashboardLayoutConfig());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState<DashboardProfile[]>([
    { key: 'default', name: 'Default', predefined: true },
    { key: 'analytics', name: 'Analytics Focus', predefined: true },
    { key: 'operations', name: 'Operations Focus', predefined: true },
  ]);
  const [activeProfileKey, setActiveProfileKey] = useState('default');
  const [customProfileName, setCustomProfileName] = useState('');
  const [draggingPreviewWidgetId, setDraggingPreviewWidgetId] = useState<string | null>(null);
  const [lastMovedPreviewWidgetId, setLastMovedPreviewWidgetId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const previewCanvasRef = useRef<HTMLDivElement | null>(null);
  const dragPointerOffsetRef = useRef({ x: 0, y: 0 });

  const canCustomize = hasPermission('customize_dashboard');
  const profileStorageKey = `dashboard_active_profile:${tenantSlug || 'tenant'}`;

  useEffect(() => {
    if (!canCustomize) {
      setLoading(false);
      return;
    }
    let isActive = true;
    const storedProfile = localStorage.getItem(profileStorageKey) || 'default';
    setActiveProfileKey(storedProfile);

    (async () => {
      try {
        const fetchedProfiles = await getDashboardProfiles();
        if (!isActive) return;
        setProfiles(fetchedProfiles);

        const profileExists = fetchedProfiles.some((p) => p.key === storedProfile);
        const effectiveProfile = profileExists ? storedProfile : 'default';
        if (!profileExists) {
          localStorage.setItem(profileStorageKey, effectiveProfile);
          setActiveProfileKey(effectiveProfile);
        }

        const { layout: fetched } = await getDashboardLayout(effectiveProfile);
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
  }, [canCustomize, t, profileStorageKey]);

  useEffect(() => {
    if (!canCustomize) return;
    let isActive = true;
    (async () => {
      try {
        const { layout: fetched } = await getDashboardLayout(activeProfileKey);
        if (!isActive) return;
        const sanitized = sanitizeDashboardLayoutConfig(fetched);
        setLayout(sanitized);
        setInitialLayout(sanitized);
      } catch (error: any) {
        if (!isActive) return;
        showNotification('error', error?.message || t('dashboard.customize.loadFailed', 'Failed to load layout.'));
      }
    })();

    return () => {
      isActive = false;
    };
  }, [activeProfileKey, canCustomize, t]);

  const draftSignature = JSON.stringify(layout.widgets.map((w) => ({ id: w.id, x: w.x, y: w.y, w: w.w, h: w.h, visible: w.visible })));
  const initialSignature = JSON.stringify(initialLayout.widgets.map((w) => ({ id: w.id, x: w.x, y: w.y, w: w.w, h: w.h, visible: w.visible })));
  const hasChanges = draftSignature !== initialSignature;

  const widgetOrder = layout.widgets.map((w) => w.id);
  const widgetById = useMemo(() => new Map(layout.widgets.map((w) => [w.id, w])), [layout.widgets]);
  const previewVisibleWidgets = useMemo(
    () => layout.widgets.filter((w) => w.visible).sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y)),
    [layout.widgets]
  );
  const visibleCount = layout.widgets.filter((w) => w.visible).length;
  const hiddenCount = layout.widgets.length - visibleCount;

  function normalizeWidgetBounds(widget: DashboardLayoutItem): DashboardLayoutItem {
    const safeW = Math.max(1, Math.min(12, widget.w));
    const minRows = getDashboardWidgetMinHeightRows(widget.id);
    const safeH = Math.max(minRows, Math.min(12, widget.h));
    const safeX = Math.max(0, Math.min(12 - safeW, widget.x));
    const safeY = Math.max(0, widget.y);
    return { ...widget, x: safeX, y: safeY, w: safeW, h: safeH };
  }

  function updateWidget(widgetId: string, partial: Partial<DashboardLayoutItem>) {
    setLayout((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) => {
        if (w.id !== widgetId) return w;
        return normalizeWidgetBounds({ ...w, ...partial });
      }),
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

  function toggleWidgetVisibility(widgetId: string) {
    setLayout((prev) => {
      const current = prev.widgets.find((w) => w.id === widgetId);
      if (!current) return prev;

      if (current.visible) {
        return {
          ...prev,
          widgets: prev.widgets.map((w) => (w.id === widgetId ? { ...w, visible: false } : w)),
        };
      }

      const maxY = prev.widgets
        .filter((w) => w.visible)
        .reduce((acc, w) => Math.max(acc, w.y + w.h), 0);
      const remaining = prev.widgets.filter((w) => w.id !== widgetId);
      const revived = { ...current, visible: true, x: 0, y: maxY };
      const nextWidgets = [...remaining, revived];
      return { ...prev, widgets: nextWidgets };
    });
  }

  function hideWidgetFromPreview(widgetId: string) {
    setLayout((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) => (w.id === widgetId ? { ...w, visible: false } : w)),
    }));
  }

  function onDragEnd(result: DropResult) {
    if (!result.destination) return;
    setLayout((prev) => ({
      ...prev,
      widgets: moveItem(prev.widgets, result.source.index, result.destination!.index),
    }));
  }

  function handlePreviewDragStart(widgetId: string, event: React.DragEvent<HTMLDivElement>) {
    setDraggingPreviewWidgetId(widgetId);
    const widgetElement = event.currentTarget.getBoundingClientRect();
    dragPointerOffsetRef.current = {
      x: Math.max(0, event.clientX - widgetElement.left),
      y: Math.max(0, event.clientY - widgetElement.top),
    };
  }

  function resolveDropPosition(event: React.DragEvent<HTMLDivElement>, widget: DashboardLayoutItem) {
    if (!previewCanvasRef.current) return { x: widget.x, y: widget.y };
    const rect = previewCanvasRef.current.getBoundingClientRect();
    const colWidth = rect.width / 12;
    const rowHeight = 44;
    const scrollLeft = previewCanvasRef.current.scrollLeft;
    const scrollTop = previewCanvasRef.current.scrollTop;

    const adjustedX =
      event.clientX - rect.left + scrollLeft - Math.min(dragPointerOffsetRef.current.x, widget.w * colWidth);
    const adjustedY =
      event.clientY - rect.top + scrollTop - Math.min(dragPointerOffsetRef.current.y, widget.h * rowHeight);

    const rawX = Math.floor(adjustedX / colWidth);
    const rawY = Math.floor(adjustedY / rowHeight);
    return {
      x: Math.max(0, Math.min(12 - widget.w, rawX)),
      y: Math.max(0, rawY),
    };
  }

  function handlePreviewDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!draggingPreviewWidgetId) return;
    const currentWidget = layout.widgets.find((w) => w.id === draggingPreviewWidgetId);
    if (!currentWidget) return;
    const next = resolveDropPosition(event, currentWidget);
    setDropTarget({ ...next, w: currentWidget.w, h: currentWidget.h });
  }

  function handlePreviewDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!draggingPreviewWidgetId || !previewCanvasRef.current) return;
    const currentWidget = layout.widgets.find((w) => w.id === draggingPreviewWidgetId);
    if (!currentWidget) return;
    const next = resolveDropPosition(event, currentWidget);

    updateWidget(draggingPreviewWidgetId, { x: next.x, y: next.y });
    setLastMovedPreviewWidgetId(draggingPreviewWidgetId);
    window.setTimeout(() => {
      setLastMovedPreviewWidgetId((current) => (current === draggingPreviewWidgetId ? null : current));
    }, 420);
    setDraggingPreviewWidgetId(null);
    setDropTarget(null);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const activeProfile = profiles.find((profile) => profile.key === activeProfileKey);
      const nextConfig: DashboardLayoutConfig = {
        ...layout,
        widgets: layout.widgets,
      };
      const saved = await saveDashboardLayout(nextConfig, activeProfileKey, activeProfile?.name);
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
      const resetConfig = await resetDashboardLayout(activeProfileKey);
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
      widgets: layout.widgets,
    });
    sessionStorage.setItem('dashboard_layout_preview_draft', JSON.stringify(packedDraft));
    const previewUrl = tenantSlug ? `/${tenantSlug}/admin?layoutPreview=1` : '/';
    window.open(previewUrl, '_blank', 'noopener,noreferrer');
  }

  async function handleCreateCustomProfile() {
    const name = customProfileName.trim();
    if (!name) {
      showNotification('warning', t('dashboard.customize.customProfileNameRequired', 'Please enter a profile name.'));
      return;
    }
    const key = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'profile'}`;
    if (profiles.some((profile) => profile.key === key)) {
      showNotification('warning', t('dashboard.customize.customProfileExists', 'A profile with this name already exists.'));
      return;
    }
    try {
      const defaultLayout = getDefaultDashboardLayoutConfig();
      await saveDashboardLayout(defaultLayout, key, name);
      const nextProfiles = [...profiles, { key, name, predefined: false }];
      setProfiles(nextProfiles);
      setCustomProfileName('');
      setActiveProfileKey(key);
      localStorage.setItem(profileStorageKey, key);
      showNotification('success', t('dashboard.customize.customProfileCreated', 'Custom profile created.'));
    } catch (error: any) {
      showNotification('error', error?.message || t('dashboard.customize.saveFailed', 'Failed to save layout.'));
    }
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
            onClick={() =>
              setLayout((prev) => ({
                ...prev,
                widgets: prev.widgets.map((w) => ({ ...w, visible: true })),
              }))
            }
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

      <div className="rounded-xl border border-gray-200 bg-white p-3 md:p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {t('dashboard.customize.activeProfile', 'Active profile')}
            </p>
            <p className="text-xs text-gray-500">
              {t('dashboard.customize.profileHint', 'Switch between presets or use your own custom profile.')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {profiles
              .filter((profile) => profile.predefined)
              .map((profile) => {
                const isActive = activeProfileKey === profile.key;
                return (
                  <button
                    key={profile.key}
                    type="button"
                    onClick={() => {
                      setActiveProfileKey(profile.key);
                      localStorage.setItem(profileStorageKey, profile.key);
                    }}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                      isActive
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {profile.name}
                  </button>
                );
              })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)_auto] gap-2 items-end">
          <label className="text-xs text-gray-600">
            {t('dashboard.customize.allProfiles', 'All profiles')}
            <select
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm bg-white"
              value={activeProfileKey}
              onChange={(e) => {
                const nextKey = e.target.value;
                setActiveProfileKey(nextKey);
                localStorage.setItem(profileStorageKey, nextKey);
              }}
            >
              {profiles.map((profile) => (
                <option key={profile.key} value={profile.key}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            {t('dashboard.customize.newCustomProfile', 'New custom profile')}
            <input
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
              value={customProfileName}
              onChange={(e) => setCustomProfileName(e.target.value)}
              placeholder={t('dashboard.customize.newCustomProfilePlaceholder', 'e.g. Morning Ops')}
            />
          </label>
          <Button variant="outline" onClick={handleCreateCustomProfile} className="h-10">
            {t('dashboard.customize.createProfile', 'Create')}
          </Button>
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
                          {(dragProvided, snapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={`rounded-lg border p-3 transition-colors ${
                                widget.visible ? 'border-gray-200 bg-white' : 'border-amber-200 bg-amber-50'
                              } transition-all duration-200 ease-out ${
                                snapshot.isDragging ? 'scale-[1.02] shadow-xl ring-2 ring-blue-200 z-20' : 'shadow-sm hover:shadow-md'
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
                                      onClick={() => toggleWidgetVisibility(widgetId)}
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
            {previewVisibleWidgets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                {t('dashboard.customize.emptyPreview', 'All widgets are hidden. Enable at least one widget to preview.')}
              </div>
            ) : (
              <div
                ref={previewCanvasRef}
                className="grid grid-cols-12 auto-rows-[44px] gap-2 rounded-lg border border-gray-200 bg-white p-2 min-h-[460px] max-h-[70vh] overflow-auto"
                onDragOver={handlePreviewDragOver}
                onDrop={handlePreviewDrop}
              >
                {dropTarget && (
                  <div
                    className="pointer-events-none rounded-lg border-2 border-blue-300 border-dashed bg-blue-100/40"
                    style={{
                      gridColumn: `${dropTarget.x + 1} / span ${dropTarget.w}`,
                      gridRow: `${dropTarget.y + 1} / span ${dropTarget.h}`,
                    }}
                  />
                )}
                {previewVisibleWidgets.map((widget) => {
                  const definition = DASHBOARD_WIDGET_DEFINITIONS.find((d) => d.id === widget.id);
                  if (!definition) return null;
                  const colSpan = Math.max(1, Math.min(12, widget.w));
                  const colStart = Math.max(1, Math.min(13 - colSpan, widget.x + 1));
                  const rowStart = Math.max(1, widget.y + 1);
                  const rowSpan = Math.max(1, widget.h);
                  const isDragging = draggingPreviewWidgetId === widget.id;
                  const isFreshlyMoved = lastMovedPreviewWidgetId === widget.id;
                  return (
                    <div
                      key={`preview-${widget.id}`}
                      className={`rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 hover:border-blue-300 transition-all duration-300 ease-out ${
                        isDragging ? 'scale-[1.015] opacity-85 shadow-2xl ring-2 ring-blue-300 z-20' : 'shadow-sm hover:shadow-md'
                      } ${isFreshlyMoved ? 'ring-2 ring-blue-300 bg-blue-50/70' : ''}`}
                      style={{ gridColumn: `${colStart} / span ${colSpan}`, gridRow: `${rowStart} / span ${rowSpan}` }}
                      draggable
                      onDragStart={(event) => handlePreviewDragStart(widget.id, event)}
                      onDragEnd={() => {
                        setDraggingPreviewWidgetId(null);
                        setDropTarget(null);
                      }}
                      title={t('dashboard.customize.dragPreview', 'Drag to reorder in preview')}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{t(definition.nameKey, definition.fallbackName)}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            {t('dashboard.customize.previewSize', '{{w}}/12 width', { w: widget.w })}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {t('dashboard.customize.previewHeight', 'Height {{h}}', { h: widget.h })}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-md p-1 text-gray-500 hover:bg-red-100 hover:text-red-700"
                          onClick={() => hideWidgetFromPreview(widget.id)}
                          title={t('dashboard.customize.removeFromPreview', 'Click to remove from preview')}
                          aria-label={t('dashboard.customize.removeFromPreview', 'Click to remove from preview')}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
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
