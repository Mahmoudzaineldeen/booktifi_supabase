import React from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

interface DataPoint {
  date: string;
  value: number;
}

interface Series {
  name: string;
  data: DataPoint[];
  color: string;
}

interface ComparisonChartProps {
  title: string;
  series: Series[];
  valueLabel: string;
}

export function ComparisonChart({ title, series, valueLabel }: ComparisonChartProps) {
  const { t, i18n } = useTranslation();

  if (series.length === 0 || series.every(s => s.data.length === 0)) {
    return (
      <div className="bg-gradient-to-br from-white to-blue-50 rounded-xl border border-blue-100 shadow-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-6">{title}</h3>
        <div className="text-center py-12 text-gray-500">
          {t('dashboard.noDataAvailable')}
        </div>
      </div>
    );
  }

  const allDates = Array.from(
    new Set(series.flatMap(s => s.data.map(d => d.date)))
  ).sort();

  const maxValue = Math.max(
    ...series.flatMap(s => s.data.map(d => d.value)),
    1
  );

  // Pixel-based dimensions: 1 SVG unit = 1 pixel so labels stay readable
  const PX = {
    chartHeight: 560,
    leftMargin: 56,
    rightMargin: 24,
    bottomLabelHeight: 52,
    minWidthPerDate: 72,
    fontAxis: 14,
    fontBarValue: 13,
    fontDate: 13,
  };
  const chartWidthPx = Math.max(800, allDates.length * PX.minWidthPerDate);
  const plotWidthPx = chartWidthPx - PX.leftMargin - PX.rightMargin;
  const plotBottomPx = PX.chartHeight - PX.bottomLabelHeight;
  const barWidthPx = Math.min(
    (plotWidthPx / allDates.length - 8) / Math.max(series.length, 1),
    36
  );
  const groupWidthPx = barWidthPx * series.length + 8;
  const locale = i18n.language === 'ar' ? ar : undefined;

  return (
    <div className="bg-gradient-to-br from-white to-blue-50 rounded-xl border border-blue-100 shadow-lg p-6 hover:shadow-xl transition-shadow">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">{title}</h3>

      <div className="mb-6 flex flex-wrap gap-4 justify-center">
        {series.map((s, index) => (
          <div key={index} className="flex items-center gap-2 bg-white px-3 py-1 rounded-full shadow-sm">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-sm font-medium text-gray-700">{s.name}</span>
          </div>
        ))}
      </div>

      <div className="flex justify-center">
        <div className="overflow-x-auto overflow-y-hidden rounded-lg bg-white p-4 w-full max-w-full">
          <div className="shrink-0" style={{ width: chartWidthPx }}>
            <svg
              viewBox={`0 0 ${chartWidthPx} ${PX.chartHeight}`}
              width={chartWidthPx}
              height={PX.chartHeight}
              className="block"
              style={{ minWidth: chartWidthPx }}
            >
              <defs>
                <linearGradient id="gridGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.1" />
                  <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
                </linearGradient>
                {series.map((s, idx) => (
                  <linearGradient key={idx} id={`barGradient${idx}`} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor={s.color} stopOpacity="1" />
                    <stop offset="100%" stopColor={s.color} stopOpacity="0.7" />
                  </linearGradient>
                ))}
              </defs>

              <rect
                x={PX.leftMargin}
                y={12}
                width={plotWidthPx + 4}
                height={plotBottomPx - 54}
                fill="url(#gridGradient)"
                opacity="0.3"
              />

              <line
                x1={PX.leftMargin}
                y1={plotBottomPx - 12}
                x2={chartWidthPx - PX.rightMargin}
                y2={plotBottomPx - 12}
                stroke="#3B82F6"
                strokeWidth="1.5"
              />

              {[0, 25, 50, 75, 100].map((percent) => {
                const y = plotBottomPx - 12 - ((plotBottomPx - 72) * percent) / 100;
                return (
                  <g key={percent}>
                    <line
                      x1={PX.leftMargin}
                      y1={y}
                      x2={chartWidthPx - PX.rightMargin}
                      y2={y}
                      stroke="#E0E7FF"
                      strokeWidth="1"
                      strokeDasharray="3,3"
                    />
                    <text
                      x={PX.leftMargin - 8}
                      y={y + 4}
                      textAnchor="end"
                      fill="#1e40af"
                      fontSize={PX.fontAxis}
                      fontWeight="600"
                      fontFamily="system-ui, -apple-system, sans-serif"
                    >
                      {((maxValue * percent) / 100).toFixed(0)}
                    </text>
                  </g>
                );
              })}

              {allDates.map((date, dateIndex) => {
                const groupCenterX = PX.leftMargin + (dateIndex + 0.5) * (plotWidthPx / allDates.length);
                const x = groupCenterX - groupWidthPx / 2;

                return (
                  <g key={date}>
                    {series.map((s, seriesIndex) => {
                      const dataPoint = s.data.find(d => d.date === date);
                      const value = dataPoint?.value || 0;
                      const barHeight = ((plotBottomPx - 72) * value) / maxValue;
                      const barX = x + seriesIndex * barWidthPx;
                      const barY = plotBottomPx - 12 - barHeight;

                      return (
                        <g key={`${date}-${seriesIndex}`}>
                          <rect
                            x={barX}
                            y={barY}
                            width={barWidthPx - 1}
                            height={barHeight}
                            fill={`url(#barGradient${seriesIndex})`}
                            className="transition-all hover:opacity-80 drop-shadow-md"
                            rx="2"
                          />
                          {value > 0 && (
                            <text
                              x={barX + barWidthPx / 2}
                              y={barY - 6}
                              textAnchor="middle"
                              fill="#1f2937"
                              fontSize={PX.fontBarValue}
                              fontWeight="700"
                              fontFamily="system-ui, -apple-system, sans-serif"
                            >
                              {value.toFixed(0)}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    <text
                      x={groupCenterX}
                      y={PX.chartHeight - 28}
                      textAnchor="middle"
                      fill="#1e3a8a"
                      fontSize={PX.fontDate}
                      fontWeight="600"
                      fontFamily="system-ui, -apple-system, sans-serif"
                    >
                      <tspan x={groupCenterX} dy="0">
                        {format(new Date(date), 'd', { locale })}
                      </tspan>
                      <tspan x={groupCenterX} dy="1.15em" fontSize={PX.fontDate - 1} fontWeight="500">
                        {format(new Date(date), 'MMM', { locale })}
                      </tspan>
                    </text>
                  </g>
                );
              })}
            </svg>

            <div className="text-center mt-3 text-base font-semibold text-blue-700">
              {valueLabel}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
