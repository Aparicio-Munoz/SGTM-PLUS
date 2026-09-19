import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { reportsApi } from '../../api/reportsApi'
import { useAuth } from '../../hooks/useAuth'
import { ROUTES } from '../../utils/routes'
import { exportWorkbook } from '../../utils/exportWorkbook'
import styles from './DashboardAdmin.module.css'

const POLL_INTERVAL_MS = 30_000

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Tooltip, Legend, Filler
)

const CHART_COLORS = ['#F97316', '#2563EB', '#059669', '#7C3AED', '#EF4444', '#D97706', '#06B6D4', '#EC4899']

const STATUS_COLORS = {
  Pendiente:            '#2563EB',
  'En proceso':         '#EA580C',
  'En reparación':      '#EA580C',
  'Esperando repuesto': '#D97706',
  Listo:                '#7C3AED',
  'Lista para entrega': '#7C3AED',
  Entregada:            '#059669',
}

function fmtCOP(n) {
  if (n === null || n === undefined) return '$ 0'
  return `$ ${Math.round(Number(n)).toLocaleString('es-CO')}`
}

const baseOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#CBD5E1', font: { family: 'Inter', weight: '600', size: 11 } } },
    tooltip: { backgroundColor: '#1E293B', titleColor: '#F97316', bodyColor: '#E2E8F0', borderColor: '#334155', borderWidth: 1 },
  },
  scales: {
    x: { ticks: { color: '#64748B', font: { size: 10 } }, grid: { color: 'rgba(51,65,85,0.3)' } },
    y: { ticks: { color: '#64748B', font: { size: 10 } }, grid: { color: 'rgba(51,65,85,0.3)' } },
  },
}

export function DashboardAdmin() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [financialHistory, setFinancialHistory] = useState([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(null)
  const mountedRef = useRef(true)

  const loadData = useCallback(async ({ showLoading } = {}) => {
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const result = await reportsApi.getExecutiveDashboard({ sessionActivity: showLoading !== false })
      if (mountedRef.current) setData(result)
    } catch {
      if (mountedRef.current) setError('Error al cargar el dashboard.')
    } finally {
      if (mountedRef.current && showLoading) setLoading(false)
    }
  }, [])

  async function openFinancialHistory() {
    setHistoryOpen(true)
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const history = await reportsApi.getFinancialHistory()
      if (mountedRef.current) setFinancialHistory(history)
    } catch {
      if (mountedRef.current) setHistoryError('No fue posible cargar el historial financiero.')
    } finally {
      if (mountedRef.current) setHistoryLoading(false)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    const initialLoad = setTimeout(() => loadData({ showLoading: true }), 0)
    const iv = setInterval(() => loadData({ showLoading: false }), POLL_INTERVAL_MS)
    return () => {
      mountedRef.current = false
      clearTimeout(initialLoad)
      clearInterval(iv)
    }
  }, [loadData])

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches'

  function exportPDF() {
    if (!data) return
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFontSize(16); doc.text('SGTM — Dashboard Ejecutivo', 14, 16)
    doc.setFontSize(9); doc.setTextColor(100); doc.text(`Generado: ${now.toLocaleString('es-CO')}`, 14, 23)
    const k = data.kpis
    const financial = k.financial
    autoTable(doc, {
      startY: 28,
      head: [['Métrica', 'Valor']],
      body: [
        ['Total clientes', k.totalClients], ['Total motos', k.totalMotorcycles],
        ['Órdenes activas', k.activeOrders], ['Órdenes entregadas', k.deliveredOrders],
        ['Ventas del mes', fmtCOP(financial.month.totalRevenue)], ['Ganancias del mes', fmtCOP(financial.month.profit)],
        ['Órdenes entregadas del mes', fmtCOP(financial.month.ordersRevenue)], ['Trabajos rápidos del mes', fmtCOP(financial.month.quickJobsRevenue)],
        ['Ventas del año', fmtCOP(financial.year.totalRevenue)], ['Ganancias del año', fmtCOP(financial.year.profit)],
        ['Órdenes entregadas del año', fmtCOP(financial.year.ordersRevenue)], ['Trabajos rápidos del año', fmtCOP(financial.year.quickJobsRevenue)],
        ['Ventas de hoy', fmtCOP(financial.today.totalRevenue)], ['Ganancias de hoy', fmtCOP(financial.today.profit)],
        ['Órdenes entregadas de hoy', fmtCOP(financial.today.ordersRevenue)], ['Trabajos rápidos de hoy', fmtCOP(financial.today.quickJobsRevenue)],
        ['Ventas de la quincena', fmtCOP(financial.fortnight.totalRevenue)], ['Ganancias de la quincena', fmtCOP(financial.fortnight.profit)],
        ['Órdenes entregadas de la quincena', fmtCOP(financial.fortnight.ordersRevenue)], ['Trabajos rápidos de la quincena', fmtCOP(financial.fortnight.quickJobsRevenue)],
        ['Stock bajo', k.lowStockItems],
      ],
      headStyles: { fillColor: [249, 115, 22] },
    })
    doc.save('SGTM_Dashboard.pdf')
  }

  async function exportExcel() {
    if (!data) return
    const k = data.kpis
    const financial = k.financial
    const sheets = [{ name: 'KPIs', rows: [
      { Métrica: 'Total clientes', Valor: k.totalClients },
      { Métrica: 'Total motos', Valor: k.totalMotorcycles },
      { Métrica: 'Órdenes activas', Valor: k.activeOrders },
      { Métrica: 'Órdenes entregadas', Valor: k.deliveredOrders },
      { Métrica: 'Ventas del mes', Valor: financial.month.totalRevenue },
      { Métrica: 'Ganancias del mes', Valor: financial.month.profit },
      { Métrica: 'Órdenes entregadas del mes', Valor: financial.month.ordersRevenue },
      { Métrica: 'Trabajos rápidos del mes', Valor: financial.month.quickJobsRevenue },
      { Métrica: 'Ventas del año', Valor: financial.year.totalRevenue },
      { Métrica: 'Ganancias del año', Valor: financial.year.profit },
      { Métrica: 'Órdenes entregadas del año', Valor: financial.year.ordersRevenue },
      { Métrica: 'Trabajos rápidos del año', Valor: financial.year.quickJobsRevenue },
      { Métrica: 'Ventas de hoy', Valor: financial.today.totalRevenue },
      { Métrica: 'Ganancias de hoy', Valor: financial.today.profit },
      { Métrica: 'Órdenes entregadas de hoy', Valor: financial.today.ordersRevenue },
      { Métrica: 'Trabajos rápidos de hoy', Valor: financial.today.quickJobsRevenue },
      { Métrica: 'Ventas de la quincena', Valor: financial.fortnight.totalRevenue },
      { Métrica: 'Ganancias de la quincena', Valor: financial.fortnight.profit },
      { Métrica: 'Órdenes entregadas de la quincena', Valor: financial.fortnight.ordersRevenue },
      { Métrica: 'Trabajos rápidos de la quincena', Valor: financial.fortnight.quickJobsRevenue },
      { Métrica: 'Stock bajo', Valor: k.lowStockItems },
    ] }]
    if (data.charts.topClients?.length) {
      sheets.push({
        name: 'Top Clientes',
        rows: data.charts.topClients.map((c) => ({ Cliente: c.client_name, Órdenes: c.orders_count, Total: Number(c.total_spent) })),
      })
    }
    await exportWorkbook(sheets, 'SGTM_Dashboard.xlsx')
  }

  const k = data?.kpis
  const ch = data?.charts
  const al = data?.alerts
  const financial = k?.financial
  const financialPeriods = financial ? [
    { key: 'today', label: 'Hoy', icon: '☀️' },
    { key: 'fortnight', label: 'Quincena', icon: '🗓️' },
    { key: 'month', label: 'Mes', icon: '📅' },
    { key: 'year', label: 'Año', icon: '📈' },
  ] : []

  // ── Chart configs ──────────────────────────────────
  const revenueChart = ch?.monthlyRevenue?.length ? {
    labels: ch.monthlyRevenue.map((r) => r.label),
    datasets: [
      {
        label: 'Ventas',
        data: ch.monthlyRevenue.map((r) => Number(r.revenue)),
        backgroundColor: 'rgba(249,115,22,0.35)',
        borderColor: '#F97316', borderWidth: 2, borderRadius: 6,
      },
      {
        label: 'Ganancias',
        data: ch.monthlyRevenue.map((r) => Number(r.profit)),
        backgroundColor: 'rgba(5,150,105,0.3)',
        borderColor: '#059669', borderWidth: 2, borderRadius: 6,
      },
    ],
  } : null

  const servicesChart = ch?.topServices?.length ? {
    labels: ch.topServices.map((r) => r.service_name),
    datasets: [{
      data: ch.topServices.map((r) => r.times_sold),
      backgroundColor: CHART_COLORS.slice(0, ch.topServices.length),
      borderWidth: 0,
    }],
  } : null

  const statusChart = k?.ordersByStatus ? (() => {
    const entries = Object.entries(k.ordersByStatus).filter(([, v]) => v > 0)
    return entries.length ? {
      labels: entries.map(([s]) => s),
      datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map(([s]) => STATUS_COLORS[s] ?? '#94A3B8'), borderWidth: 0 }],
    } : null
  })() : null

  const stockChart = ch?.stockByCategory?.length ? {
    labels: ch.stockByCategory.map((r) => r.category),
    datasets: [{
      label: 'Stock',
      data: ch.stockByCategory.map((r) => Number(r.total_stock)),
      backgroundColor: CHART_COLORS.slice(0, ch.stockByCategory.length).map((c) => c + '88'),
      borderColor: CHART_COLORS.slice(0, ch.stockByCategory.length),
      borderWidth: 1.5, borderRadius: 6,
    }],
  } : null

  if (loading) {
    return (
      <section className={styles.page}>
        <div className={styles.loadingState}><div className={styles.spinner} />Cargando dashboard…</div>
      </section>
    )
  }
  if (error) {
    return (
      <section className={styles.page}>
        <div className={styles.loadingState}><p>{error}</p><button className={styles.retryBtn} onClick={() => loadData({ showLoading: true })}>Reintentar</button></div>
      </section>
    )
  }

  return (
    <section className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            Dashboard ejecutivo · {now.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className={styles.title}>{greeting}, <span className={styles.accent}>{user?.username || 'Admin'}</span></h1>
          <p className={styles.subtitle}>Métricas operativas y financieras en tiempo real del taller.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.exportBtn} onClick={exportPDF}>PDF</button>
          <button className={styles.exportBtn} onClick={exportExcel}>Excel</button>
          <Link to={ROUTES.adminOrdenes} className={styles.newOrderBtn}>+ Nueva orden</Link>
        </div>
      </div>

      {/* Indicadores operativos */}
      <div className={styles.kpiGrid}>
        {[
          { label: 'Total clientes',    value: k.totalClients,     icon: '👥', color: '#2563EB' },
          { label: 'Total motos',       value: k.totalMotorcycles, icon: '🏍️', color: '#7C3AED' },
          { label: 'Órdenes activas',   value: k.activeOrders,     icon: '📋', color: '#EA580C' },
          { label: 'Entregadas',        value: k.deliveredOrders,  icon: '✅', color: '#059669' },
          { label: 'Stock bajo',        value: k.lowStockItems,    icon: '⚠️', color: '#DC2626' },
        ].map((kpi) => (
          <div key={kpi.label} className={styles.kpiCard} style={{ '--kpi-color': kpi.color }}>
            <div className={styles.kpiIcon}>{kpi.icon}</div>
            <div className={styles.kpiContent}>
              <strong className={styles.kpiValue}>{kpi.value}</strong>
              <span className={styles.kpiLabel}>{kpi.label}</span>
            </div>
          </div>
        ))}
      </div>

      {financial ? (
        <section className={styles.financialSection} aria-labelledby="financial-summary-title">
          <div className={styles.financialHeader}>
            <div>
              <h2 id="financial-summary-title" className={styles.financialTitle}>Resumen financiero</h2>
              <p className={styles.financialDescription}>
                Ventas: órdenes entregadas y trabajos rápidos. Ganancias: ventas menos el costo de repuestos y la comisión de cada técnico.
              </p>
            </div>
            <div className={styles.financialActions}>
              {financialPeriods.some(({ key }) => financial[key].hasEstimatedCosts) ? (
                <span className={styles.estimateBadge}>Histórico con costos estimados</span>
              ) : null}
              <button type="button" className={styles.historyButton} onClick={openFinancialHistory}>Meses anteriores</button>
            </div>
          </div>
          <div className={styles.totalProfitCard}>
            <span>Ganancias totales</span>
            <strong>{fmtCOP(financial.allTime.profit)}</strong>
            <small>Histórico de órdenes entregadas y trabajos rápidos</small>
          </div>
          <div className={styles.financialGrid}>
            {financialPeriods.flatMap(({ key, label, icon }) => {
              const totals = financial[key]
              return [
                {
                  key: `${key}-sales`, label: `Ventas de ${label.toLowerCase()}`, value: totals.totalRevenue, icon, color: '#F97316',
                  detail: `Órdenes: ${fmtCOP(totals.ordersRevenue)} · Rápidos: ${fmtCOP(totals.quickJobsRevenue)}`,
                },
                {
                  key: `${key}-profit`, label: `Ganancias de ${label.toLowerCase()}`, value: totals.profit, icon: '📈', color: '#059669',
                  detail: `Costos directos: ${fmtCOP(totals.totalDirectCosts)}`,
                },
              ]
            }).map((metric) => (
              <div key={metric.key} className={styles.kpiCard} style={{ '--kpi-color': metric.color }}>
                <div className={styles.kpiIcon}>{metric.icon}</div>
                <div className={styles.kpiContent}>
                  <strong className={styles.kpiValue}>{fmtCOP(metric.value)}</strong>
                  <span className={styles.kpiLabel}>{metric.label}</span>
                  <span className={styles.financialMetricDetail}>{metric.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Charts Grid */}
      <div className={styles.chartsGrid}>
        <div className={`${styles.chartCard} ${styles.chartWide}`}>
          <h3 className={styles.chartTitle}>Ventas y ganancias mensuales</h3>
          <div className={styles.chartWrap}>
            {revenueChart ? <Bar data={revenueChart} options={baseOpts} /> : <p className={styles.noData}>Sin datos</p>}
          </div>
        </div>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Servicios más vendidos</h3>
          <div className={styles.chartWrap}>
            {servicesChart ? <Doughnut data={servicesChart} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#CBD5E1', font: { size: 10 } } }, tooltip: baseOpts.plugins.tooltip } }} /> : <p className={styles.noData}>Sin datos</p>}
          </div>
        </div>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Órdenes por estado</h3>
          <div className={styles.chartWrap}>
            {statusChart ? <Doughnut data={statusChart} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#CBD5E1', font: { size: 10 } } }, tooltip: baseOpts.plugins.tooltip } }} /> : <p className={styles.noData}>Sin órdenes</p>}
          </div>
        </div>
        <div className={`${styles.chartCard} ${styles.chartWide}`}>
          <h3 className={styles.chartTitle}>Inventario por categoría</h3>
          <div className={styles.chartWrap}>
            {stockChart ? <Bar data={stockChart} options={{ ...baseOpts, plugins: { ...baseOpts.plugins, legend: { display: false } } }} /> : <p className={styles.noData}>Sin datos</p>}
          </div>
        </div>
      </div>

      {/* Bottom row: top técnicos + clientes + alertas */}
      <div className={styles.bottomGrid}>
        {/* Top técnicos */}
        {ch?.ordersByTech?.length ? (
          <div className={styles.glassCard}>
            <h3 className={styles.cardTitle}>Top técnicos</h3>
            <div className={styles.techList}>
              {ch.ordersByTech.slice(0, 5).map((t, i) => (
                <div key={i} className={styles.techRow}>
                  <span className={styles.techRank}>{i + 1}</span>
                  <div className={styles.techInfo}>
                    <strong>{t.employee_name}</strong>
                    <span className={styles.techMeta}>{t.specialty} · {t.completed} completadas</span>
                  </div>
                  <span className={styles.techCount}>{t.total_orders}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Top clientes */}
        {ch?.topClients?.length ? (
          <div className={styles.glassCard}>
            <h3 className={styles.cardTitle}>Top clientes</h3>
            <div className={styles.techList}>
              {ch.topClients.slice(0, 5).map((c, i) => (
                <div key={i} className={styles.techRow}>
                  <span className={styles.techRank}>{i + 1}</span>
                  <div className={styles.techInfo}>
                    <strong>{c.client_name}</strong>
                    <span className={styles.techMeta}>{c.orders_count} servicios · {fmtCOP(c.total_spent)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Alertas */}
        <div className={styles.glassCard}>
          <h3 className={styles.cardTitle}>Alertas</h3>
          <div className={styles.alertList}>
            {al?.lowStock?.map((item) => (
              <div key={`ls-${item.id}`} className={styles.alertRow}>
                <span className={styles.alertDot} style={{ background: '#DC2626' }} />
                <div className={styles.alertInfo}>
                  <span className={styles.alertName}>{item.name}</span>
                  <span className={styles.alertSub}>Stock: {item.quantity} / mín: {item.min_stock}</span>
                </div>
                <span className={styles.alertTag} style={{ background: '#FEE2E2', color: '#DC2626' }}>Stock bajo</span>
              </div>
            ))}
            {!al?.lowStock?.length ? (
              <p className={styles.noAlerts}>Todo bajo control</p>
            ) : null}
          </div>
        </div>
      </div>

      {historyOpen ? (
        <div className={styles.historyBackdrop} role="presentation" onMouseDown={() => setHistoryOpen(false)}>
          <section className={styles.historyModal} role="dialog" aria-modal="true" aria-labelledby="financial-history-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.historyModalHeader}>
              <div>
                <h2 id="financial-history-title">Meses anteriores</h2>
                <p>Ventas y ganancias calculadas desde órdenes entregadas y trabajos rápidos.</p>
              </div>
              <button type="button" className={styles.closeHistoryButton} onClick={() => setHistoryOpen(false)} aria-label="Cerrar historial">×</button>
            </div>
            {historyLoading ? <p className={styles.historyState}>Cargando historial…</p> : null}
            {historyError ? <p className={styles.historyError}>{historyError}</p> : null}
            {!historyLoading && !historyError ? (
              financialHistory.length ? (
                <div className={styles.historyList}>
                  {financialHistory.map((month) => (
                    <article key={month.month} className={styles.historyRow}>
                      <div><strong>{month.label}</strong><span>{month.deliveredOrders} órdenes · {month.quickJobs} rápidos</span></div>
                      <div><span>Ventas</span><strong>{fmtCOP(month.totalRevenue)}</strong></div>
                      <div className={styles.historyProfit}><span>Ganancias</span><strong>{fmtCOP(month.profit)}</strong></div>
                    </article>
                  ))}
                </div>
              ) : <p className={styles.historyState}>Aún no hay operaciones con ganancia registrada.</p>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  )
}
