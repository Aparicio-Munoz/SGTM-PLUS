import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { reportsApi } from '../../../api/reportsApi'
import { usersApi } from '../../../api/usersApi'
import { Pagination } from '../../../components/Pagination/Pagination'
import { exportWorkbook } from '../../../utils/exportWorkbook'
import styles from './Reportes.module.css'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Tooltip, Legend, Filler
)

// ── Constantes & helpers ─────────────────────────────────────
const CHART_COLORS = ['#F97316', '#2563EB', '#059669', '#7C3AED', '#EF4444', '#D97706', '#06B6D4', '#EC4899']

function fmtCOP(n) {
  return `$ ${Math.round(Number(n)).toLocaleString('es-CO')}`
}

function fmtPercent(n) {
  return `${Number(n ?? 0).toFixed(1)}%`
}

const FINANCIAL_PERIODS = [
  { key: 'today', label: 'Hoy' },
  { key: 'fortnight', label: 'Quincena actual' },
  { key: 'month', label: 'Mes actual' },
  { key: 'year', label: 'Año actual' },
]

function financialRows(summary) {
  if (!summary) return []
  return FINANCIAL_PERIODS.map(({ key, label }) => ({ period: label, ...summary[key] }))
}

const ACTION_META = {
  CREAR_CLIENTE:           { label: 'Crear cliente',         color: '#059669', bg: '#D1FAE5' },
  EDITAR_CLIENTE:          { label: 'Editar cliente',        color: '#2563EB', bg: '#DBEAFE' },
  ELIMINAR_CLIENTE:        { label: 'Eliminar cliente',      color: '#DC2626', bg: '#FEE2E2' },
  CREAR_ORDEN:             { label: 'Crear orden',           color: '#059669', bg: '#D1FAE5' },
  CAMBIAR_ESTADO:          { label: 'Cambiar estado',        color: '#D97706', bg: '#FEF3C7' },
  ELIMINAR_REPUESTO:       { label: 'Eliminar repuesto',     color: '#DC2626', bg: '#FEE2E2' },
  EDITAR_INVENTARIO:       { label: 'Editar inventario',     color: '#2563EB', bg: '#DBEAFE' },
  CREAR_EMPLEADO:          { label: 'Crear empleado',        color: '#059669', bg: '#D1FAE5' },
  LOGIN_EXITOSO:           { label: 'Login exitoso',         color: '#059669', bg: '#D1FAE5' },
  LOGIN_FALLIDO:           { label: 'Login fallido',         color: '#DC2626', bg: '#FEE2E2' },
  IP_BLOQUEADA:            { label: 'IP bloqueada',          color: '#DC2626', bg: '#FEE2E2' },
  LOGOUT:                  { label: 'Cierre de sesión',      color: '#64748B', bg: '#F1F5F9' },
  CAMBIO_CONTRASENA:       { label: 'Cambio de contraseña',  color: '#7C3AED', bg: '#EDE9FE' },
  RECUPERACION_CONTRASENA: { label: 'Recuperación clave',    color: '#D97706', bg: '#FEF3C7' },
}

const AUDIT_SKIP_KEYS = new Set(['id', 'created_at', 'updated_at', 'password_hash', 'deleted_at', 'tracking_token'])

function auditDetail(row) {
  const oldV = row.old_values
  const newV = row.new_values
  if (oldV && newV && typeof oldV === 'object' && typeof newV === 'object') {
    const changes = []
    for (const k of Object.keys(newV)) {
      if (AUDIT_SKIP_KEYS.has(k)) continue
      if (String(oldV[k] ?? '') !== String(newV[k] ?? '')) {
        changes.push(`${k}: ${oldV[k] ?? '∅'} → ${newV[k] ?? '∅'}`)
      }
    }
    return changes.length ? changes.slice(0, 3).join(' · ') : '—'
  }
  if (newV && typeof newV === 'object') {
    return Object.entries(newV).filter(([k, v]) => !AUDIT_SKIP_KEYS.has(k) && v != null).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'
  }
  return '—'
}

function fmtAuditDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Opciones base de gráficas (tema SGTM) ────────────────────
const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#64748B', font: { family: 'Inter', weight: '600' } } } },
  scales: {
    x: { ticks: { color: '#94A3B8', font: { size: 11 } }, grid: { color: 'rgba(226,232,240,0.5)' } },
    y: { ticks: { color: '#94A3B8', font: { size: 11 } }, grid: { color: 'rgba(226,232,240,0.5)' } },
  },
}

// ── Exportar a Excel ─────────────────────────────────────────
async function exportToExcel(sheetData, filename) {
  await exportWorkbook(sheetData.map(({ name, data }) => ({ name, rows: data })), filename)
}

// ── Exportar a PDF ───────────────────────────────────────────
function exportToPDF(title, columns, rows, filename) {
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(16)
  doc.setTextColor(15, 23, 42)
  doc.text(`SGTM — ${title}`, 14, 16)
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, 23)
  autoTable(doc, {
    startY: 28,
    head: [columns],
    body: rows,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [29, 78, 216], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  })
  doc.save(filename)
}

// ══════════════════════════════════════════════════════════════
// AUDITORÍA PANEL (preservado de la implementación anterior)
// ══════════════════════════════════════════════════════════════
function AuditoriaPanel() {
  const mountedRef = useRef(true)
  const [logs, setLogs] = useState([])
  const [pagination, setPagination] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [users, setUsers] = useState([])
  const [actions, setActions] = useState([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [userId, setUserId] = useState('')
  const [action, setAction] = useState('')

  useEffect(() => {
    mountedRef.current = true
    usersApi.getAll({ limit: 200 }).then((res) => { if (mountedRef.current) setUsers(res.data ?? []) }).catch(() => {})
    reportsApi.getAuditActions().then((res) => { if (mountedRef.current) setActions(res ?? []) }).catch(() => {})
    return () => { mountedRef.current = false }
  }, [])

  const loadLogs = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await reportsApi.getAuditLogs({ date_from: dateFrom || undefined, date_to: dateTo || undefined, user_id: userId || undefined, action: action || undefined, page, limit: 15 })
      if (!mountedRef.current) return
      setLogs(res.data ?? []); setPagination(res.pagination ?? null)
    } catch { if (mountedRef.current) setError('No se pudo cargar la auditoría.') }
    finally { if (mountedRef.current) setLoading(false) }
  }, [page, dateFrom, dateTo, userId, action])

  useEffect(() => {
    const timer = setTimeout(() => loadLogs(), 0)
    return () => clearTimeout(timer)
  }, [loadLogs])

  const hasFilters = dateFrom || dateTo || userId || action

  return (
    <div className={styles.auditSection}>
      <div className={styles.auditHeader}>
        <h2 className={styles.blockTitle}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fillRule="evenodd" d="M10 1c-1.716 0-3.408.106-5.07.31C3.806 1.45 3 2.414 3 3.517V16.75A2.25 2.25 0 0 0 5.25 19h9.5A2.25 2.25 0 0 0 17 16.75V3.517c0-1.103-.806-2.068-1.93-2.207A41.403 41.403 0 0 0 10 1ZM7.25 6a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 0-1.5h-5.5Zm0 3.5a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 0-1.5h-5.5Zm0 3.5a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clipRule="evenodd" /></svg>
          Auditoría del sistema
        </h2>
      </div>
      <div className={styles.auditFilters}>
        <label className={styles.auditField}><span>Desde</span><input type="date" value={dateFrom} onChange={(e) => { setPage(1); setDateFrom(e.target.value) }} /></label>
        <label className={styles.auditField}><span>Hasta</span><input type="date" value={dateTo} onChange={(e) => { setPage(1); setDateTo(e.target.value) }} /></label>
        <label className={styles.auditField}><span>Usuario</span><select value={userId} onChange={(e) => { setPage(1); setUserId(e.target.value) }}><option value="">Todos</option>{users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}</select></label>
        <label className={styles.auditField}><span>Acción</span><select value={action} onChange={(e) => { setPage(1); setAction(e.target.value) }}><option value="">Todas</option>{actions.map((a) => <option key={a} value={a}>{ACTION_META[a]?.label ?? a}</option>)}</select></label>
        {hasFilters ? <button type="button" className={styles.auditClearBtn} onClick={() => { setPage(1); setDateFrom(''); setDateTo(''); setUserId(''); setAction('') }}>Limpiar</button> : null}
      </div>
      {loading ? <p className={styles.emptyHint}>Cargando auditoría…</p> : error ? <p className={styles.emptyHint}>{error}</p> : logs.length === 0 ? <p className={styles.emptyHint}>{hasFilters ? 'Sin resultados.' : 'Sin registros.'}</p> : (
        <>
          <div className={styles.auditTableWrap}>
            <table className={styles.auditTable}>
              <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Registro</th><th>Detalle</th><th>IP</th></tr></thead>
              <tbody>
                {logs.map((row) => { const meta = ACTION_META[row.action] ?? { label: row.action, color: '#64748B', bg: '#F1F5F9' }; return (
                  <tr key={row.id}>
                    <td data-label="Fecha">{fmtAuditDate(row.created_at)}</td>
                    <td data-label="Usuario">{row.user_name ?? '—'}</td>
                    <td data-label="Acción"><span className={styles.auditBadge} style={{ background: meta.bg, color: meta.color }}>{meta.label}</span></td>
                    <td data-label="Registro">{row.table_name ? `${row.table_name}${row.record_id ? ` #${row.record_id}` : ''}` : '—'}</td>
                    <td data-label="Detalle"><span className={styles.auditDetail}>{auditDetail(row)}</span></td>
                    <td data-label="IP">{row.ip_address ?? '—'}</td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={pagination?.totalPages} total={pagination?.total} onPageChange={setPage} disabled={loading} />
        </>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL: REPORTES
// ══════════════════════════════════════════════════════════════
export function Reportes() {
  const [chartData, setChartData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    loadData()
    return () => { mountedRef.current = false }
  }, [])

  async function loadData() {
    setLoading(true); setError(null)
    try {
      const data = await reportsApi.getChartData()
      if (mountedRef.current) setChartData(data)
    } catch { if (mountedRef.current) setError('Error cargando datos de reportes.') }
    finally { if (mountedRef.current) setLoading(false) }
  }

  // ── Export handlers ────────────────────────────────────────
  async function handleExportExcel() {
    if (!chartData) return
    const sheets = []
    const financial = financialRows(chartData.financialSummary)
    if (financial.length) {
      sheets.push({
        name: 'Resumen financiero',
        data: financial.map((row) => ({
          Período: row.period,
          Ventas: Number(row.totalRevenue),
          'Órdenes entregadas': row.deliveredOrders,
          'Trabajos rápidos': Number(row.quickJobsRevenue),
          'Costo de repuestos': Number(row.partsCost),
          'Comisiones técnicas': Number(row.technicianCommissions),
          'Pago trabajos rápidos': Number(row.quickJobPayout),
          'Costos directos': Number(row.totalDirectCosts),
          Ganancias: Number(row.profit),
          Margen: Number(row.profitMargin) / 100,
        })),
      })
    }
    if (chartData.monthlyRevenue?.length) {
      sheets.push({ name: 'Ventas mensuales', data: chartData.monthlyRevenue.map((r) => ({ Mes: r.label, Órdenes: r.orders_count, Ventas: Number(r.revenue), 'Costos directos': Number(r.totalDirectCosts), Ganancias: Number(r.profit) })) })
    }
    if (chartData.dailyRevenueThisMonth?.length) {
      sheets.push({ name: 'Ventas diarias', data: chartData.dailyRevenueThisMonth.map((r) => ({ Día: r.day_number, Ventas: Number(r.revenue), 'Costos directos': Number(r.totalDirectCosts), Ganancias: Number(r.profit) })) })
    }
    if (chartData.fortnightComparison?.length) {
      sheets.push({ name: 'Quincenas', data: chartData.fortnightComparison.map((r) => ({ Quincena: r.fortnight === 'primera' ? 'Quincena 1 (1-15)' : 'Quincena 2 (16-fin)', Órdenes: r.orders_count, Ventas: Number(r.revenue), 'Costos directos': Number(r.totalDirectCosts), Ganancias: Number(r.profit) })) })
    }
    if (chartData.ordersByTech?.length) {
      sheets.push({ name: 'Por Técnico', data: chartData.ordersByTech.map((r) => ({ Técnico: r.employee_name, Especialidad: r.specialty, Total: r.total_orders, Completadas: r.completed, Activas: r.active })) })
    }
    if (chartData.topServices?.length) {
      sheets.push({ name: 'Servicios', data: chartData.topServices.map((r) => ({ Servicio: r.service_name, Vendidos: r.times_sold, Ingresos: Number(r.revenue) })) })
    }
    if (chartData.topClients?.length) {
      sheets.push({ name: 'Clientes', data: chartData.topClients.map((r) => ({ Cliente: r.client_name, Teléfono: r.phone, Órdenes: r.orders_count, 'Total gastado': Number(r.total_spent) })) })
    }
    if (chartData.appointmentsByMonth?.length) {
      sheets.push({ name: 'Citas', data: chartData.appointmentsByMonth.map((r) => ({ Mes: r.label, Total: r.total, Atendidas: r.attended, Canceladas: r.cancelled, Pendientes: r.pending })) })
    }
    if (chartData.stockByCategory?.length) {
      sheets.push({ name: 'Inventario', data: chartData.stockByCategory.map((r) => ({ Categoría: r.category, Items: r.items_count, Stock: r.total_stock, Agotado: r.out_of_stock, 'Stock bajo': r.low_stock })) })
    }
    await exportToExcel(sheets, 'SGTM_Reportes.xlsx')
  }

  function handleExportPDF() {
    if (!chartData) return
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFontSize(18); doc.setTextColor(15, 23, 42)
    doc.text('SGTM — Reportes', 14, 16)
    doc.setFontSize(9); doc.setTextColor(100, 116, 139)
    doc.text(`Generado: ${new Date().toLocaleString('es-CO')}`, 14, 23)
    let y = 30

    const financial = financialRows(chartData.financialSummary)
    if (financial.length) {
      autoTable(doc, {
        startY: y, head: [['Período', 'Ventas', 'Costos directos', 'Ganancias']],
        body: financial.map((row) => [row.period, fmtCOP(row.totalRevenue), fmtCOP(row.totalDirectCosts), fmtCOP(row.profit)]),
        styles: { fontSize: 8 }, headStyles: { fillColor: [5, 150, 105] },
      })
      y = doc.lastAutoTable.finalY + 10
    }
    if (chartData.monthlyRevenue?.length) {
      autoTable(doc, {
        startY: y, head: [['Mes', 'Órdenes', 'Ventas', 'Ganancias']],
        body: chartData.monthlyRevenue.map((r) => [r.label, r.orders_count, fmtCOP(r.revenue), fmtCOP(r.profit)]),
        styles: { fontSize: 8 }, headStyles: { fillColor: [249, 115, 22] },
      })
      y = doc.lastAutoTable.finalY + 10
    }
    if (chartData.fortnightComparison?.length) {
      const primera = chartData.fortnightComparison.find((r) => r.fortnight === 'primera') ?? { orders_count: 0, revenue: 0 }
      const segunda = chartData.fortnightComparison.find((r) => r.fortnight === 'segunda') ?? { orders_count: 0, revenue: 0 }
      autoTable(doc, {
        startY: y, head: [['Período', 'Órdenes', 'Ventas', 'Ganancias']],
        body: [
          ['Quincena 1 (1–15)', primera.orders_count, fmtCOP(primera.revenue), fmtCOP(primera.profit)],
          ['Quincena 2 (16–fin)', segunda.orders_count, fmtCOP(segunda.revenue), fmtCOP(segunda.profit)],
        ],
        styles: { fontSize: 8 }, headStyles: { fillColor: [13, 148, 136] },
      })
      y = doc.lastAutoTable.finalY + 10
    }
    if (chartData.ordersByTech?.length) {
      autoTable(doc, {
        startY: y, head: [['Técnico', 'Total', 'Completadas', 'Activas']],
        body: chartData.ordersByTech.map((r) => [r.employee_name, r.total_orders, r.completed, r.active]),
        styles: { fontSize: 8 }, headStyles: { fillColor: [37, 99, 235] },
      })
      y = doc.lastAutoTable.finalY + 10
    }
    if (chartData.topClients?.length) {
      autoTable(doc, {
        startY: y, head: [['Cliente', 'Órdenes', 'Total']],
        body: chartData.topClients.slice(0, 10).map((r) => [r.client_name, r.orders_count, fmtCOP(r.total_spent)]),
        styles: { fontSize: 8 }, headStyles: { fillColor: [5, 150, 105] },
      })
    }
    doc.save('SGTM_Reportes.pdf')
  }

  // ── Chart configs ──────────────────────────────────────────
  const revenueChart = chartData?.monthlyRevenue?.length ? {
    data: {
      labels: chartData.monthlyRevenue.map((r) => r.label),
      datasets: [
        {
          label: 'Ventas',
          data: chartData.monthlyRevenue.map((r) => Number(r.revenue)),
          borderColor: '#F97316', backgroundColor: 'rgba(249,115,22,0.1)',
          tension: 0.4, fill: true, pointBackgroundColor: '#F97316',
        },
        {
          label: 'Ganancias',
          data: chartData.monthlyRevenue.map((r) => Number(r.profit)),
          borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.08)',
          tension: 0.4, fill: true, pointBackgroundColor: '#059669',
        },
      ],
    },
    options: chartDefaults,
  } : null

  const servicesChart = chartData?.topServices?.length ? {
    data: {
      labels: chartData.topServices.slice(0, 6).map((r) => r.service_name),
      datasets: [{
        label: 'Veces vendido',
        data: chartData.topServices.slice(0, 6).map((r) => r.times_sold),
        backgroundColor: CHART_COLORS.slice(0, 6),
        borderRadius: 6,
      }],
    },
    options: { ...chartDefaults, indexAxis: 'y', plugins: { ...chartDefaults.plugins, legend: { display: false } } },
  } : null

  const clientsChart = chartData?.topClients?.length ? {
    data: {
      labels: chartData.topClients.slice(0, 6).map((r) => (r.client_name || 'Sin nombre').split(' ')[0]),
      datasets: [{
        label: 'Órdenes',
        data: chartData.topClients.slice(0, 6).map((r) => r.orders_count),
        backgroundColor: CHART_COLORS.slice(0, 6),
        borderRadius: 6,
      }],
    },
    options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { display: false } } },
  } : null

  const dailyRevenueChart = chartData?.dailyRevenueThisMonth?.length ? {
    data: {
      labels: chartData.dailyRevenueThisMonth.map((r) => r.day_number),
      datasets: [
        {
          label: 'Ventas',
          data: chartData.dailyRevenueThisMonth.map((r) => Number(r.revenue)),
          borderColor: '#0D9488', backgroundColor: 'rgba(13,148,136,0.1)',
          tension: 0.3, fill: true, pointBackgroundColor: '#0D9488', pointRadius: 3,
        },
        {
          label: 'Ganancias',
          data: chartData.dailyRevenueThisMonth.map((r) => Number(r.profit)),
          borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.08)',
          tension: 0.3, fill: true, pointBackgroundColor: '#059669', pointRadius: 3,
        },
      ],
    },
    options: {
      ...chartDefaults,
      plugins: { ...chartDefaults.plugins, legend: { display: false } },
      scales: {
        ...chartDefaults.scales,
        x: { ...chartDefaults.scales.x, title: { display: true, text: 'Día del mes', color: '#94A3B8', font: { size: 11 } } },
      },
    },
  } : null

  const stockChart = chartData?.stockByCategory?.length ? {
    data: {
      labels: chartData.stockByCategory.map((r) => r.category),
      datasets: [{
        data: chartData.stockByCategory.map((r) => Number(r.total_stock)),
        backgroundColor: CHART_COLORS.slice(0, chartData.stockByCategory.length),
        borderWidth: 0,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#64748B', font: { size: 11 } } } } },
  } : null
  const financial = financialRows(chartData?.financialSummary)
  const hasEstimatedCosts = financial.some((row) => row.hasEstimatedCosts)

  return (
    <section className={styles.page}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Módulo administrativo</p>
          <h1 className={styles.title}>Reportes</h1>
          <p className={styles.subtitle}>Ventas, ganancias, tendencias e historial de actividad.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.exportBtn} onClick={handleExportPDF} disabled={!chartData}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" /><path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" /></svg>
            PDF
          </button>
          <button type="button" className={styles.exportBtn} onClick={handleExportExcel} disabled={!chartData}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" /><path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" /></svg>
            Excel
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className={styles.loadingState}><div className={styles.spinner} />Cargando reportes…</div>
      ) : error ? (
        <div className={styles.loadingState}>
          <p>{error}</p>
          <button type="button" className={styles.retryBtn} onClick={loadData}>Reintentar</button>
        </div>
      ) : (
        <>
          {financial.length ? (
            <section className={styles.financialSummary} aria-labelledby="financial-report-title">
              <div className={styles.financialSummaryHeader}>
                <div>
                  <h2 id="financial-report-title" className={styles.financialSummaryTitle}>Ventas y ganancias</h2>
                  <p className={styles.financialSummaryDescription}>Las ganancias descuentan repuestos y la comisión de cada técnico. No incluyen nómina fija ni gastos operativos.</p>
                </div>
                {hasEstimatedCosts ? <span className={styles.estimateBadge}>Histórico con costos estimados</span> : null}
              </div>
              <div className={styles.financialCards}>
                {financial.map((row) => (
                  <article key={row.period} className={styles.financialCard}>
                    <h3>{row.period}</h3>
                    <div><span>Ventas</span><strong>{fmtCOP(row.totalRevenue)}</strong></div>
                    <p className={styles.financialSource}>Órdenes: {fmtCOP(row.ordersRevenue)} · Rápidos: {fmtCOP(row.quickJobsRevenue)}</p>
                    <div><span>Ganancias</span><strong className={styles.profitValue}>{fmtCOP(row.profit)}</strong></div>
                    <p>Costos directos: {fmtCOP(row.totalDirectCosts)} · Margen: {fmtPercent(row.profitMargin)}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {/* ── Gráficas principales ────────────────────── */}
          <div className={styles.chartsGrid}>
            {/* Ingresos mensuales */}
            <div className={styles.chartCard}>
              <h3 className={styles.chartTitle}>Ventas y ganancias mensuales</h3>
              <div className={styles.chartWrap}>
                {revenueChart ? <Line data={revenueChart.data} options={revenueChart.options} /> : <p className={styles.noData}>Sin datos de ingresos</p>}
              </div>
            </div>

            {/* Ventas y ganancias diarias */}
            <div className={`${styles.chartCard} ${styles.chartWide}`}>
              <h3 className={styles.chartTitle}>Ventas y ganancias diarias — mes en curso</h3>
              <div className={styles.chartWrap}>
                {dailyRevenueChart ? <Line data={dailyRevenueChart.data} options={dailyRevenueChart.options} /> : <p className={styles.noData}>Sin datos financieros diarios</p>}
              </div>
            </div>

            {/* Servicios más vendidos */}
            <div className={styles.chartCard}>
              <h3 className={styles.chartTitle}>Servicios más vendidos</h3>
              <div className={styles.chartWrap}>
                {servicesChart ? <Bar data={servicesChart.data} options={servicesChart.options} /> : <p className={styles.noData}>Sin datos de servicios</p>}
              </div>
            </div>

            {/* Top clientes */}
            <div className={styles.chartCard}>
              <h3 className={styles.chartTitle}>Top clientes</h3>
              <div className={styles.chartWrap}>
                {clientsChart ? <Bar data={clientsChart.data} options={clientsChart.options} /> : <p className={styles.noData}>Sin datos de clientes</p>}
              </div>
            </div>

            {/* Stock por categoría */}
            <div className={styles.chartCard}>
              <h3 className={styles.chartTitle}>Stock disponible</h3>
              <div className={styles.chartWrap}>
                {stockChart ? <Doughnut data={stockChart.data} options={stockChart.options} /> : <p className={styles.noData}>Sin datos de inventario</p>}
              </div>
            </div>
          </div>

          {/* ── Tablas de detalle ──────────────────────── */}
          <div className={styles.detailGrid}>
            {/* Quincena 1 vs Quincena 2 */}
            {chartData?.fortnightComparison?.length ? (() => {
              const primera = chartData.fortnightComparison.find((r) => r.fortnight === 'primera') ?? { orders_count: 0, revenue: 0 }
              const segunda = chartData.fortnightComparison.find((r) => r.fortnight === 'segunda') ?? { orders_count: 0, revenue: 0 }
              const revenueDiff = Number(segunda.revenue) - Number(primera.revenue)
              const profitDiff = Number(segunda.profit) - Number(primera.profit)
              return (
                <div className={styles.detailCard}>
                  <div className={styles.detailCardHeader}>
                    <h3 className={styles.chartTitle}>Quincena 1 vs Quincena 2</h3>
                    <button type="button" className={styles.miniExport} onClick={() => exportToPDF(
                      'Quincena 1 vs Quincena 2',
                      ['Período', 'Órdenes', 'Ventas', 'Ganancias'],
                      [
                        ['Quincena 1 (1–15)', primera.orders_count, fmtCOP(primera.revenue), fmtCOP(primera.profit)],
                        ['Quincena 2 (16–fin)', segunda.orders_count, fmtCOP(segunda.revenue), fmtCOP(segunda.profit)],
                      ],
                      'Quincena_1_vs_2.pdf'
                    )}>PDF</button>
                  </div>
                  <table className={styles.miniTable}>
                    <thead><tr><th>Período</th><th>Órdenes</th><th>Ventas</th><th>Ganancias</th></tr></thead>
                    <tbody>
                      <tr><td>Quincena 1 (1–15)</td><td>{primera.orders_count}</td><td>{fmtCOP(primera.revenue)}</td><td>{fmtCOP(primera.profit)}</td></tr>
                      <tr><td>Quincena 2 (16–fin)</td><td>{segunda.orders_count}</td><td>{fmtCOP(segunda.revenue)}</td><td>{fmtCOP(segunda.profit)}</td></tr>
                      <tr>
                        <td>Diferencia (Q2 − Q1)</td>
                        <td>—</td>
                        <td style={{ color: revenueDiff >= 0 ? '#059669' : '#DC2626', fontWeight: 800 }}>
                          {revenueDiff >= 0 ? '+' : ''}{fmtCOP(revenueDiff)}
                        </td>
                        <td style={{ color: profitDiff >= 0 ? '#059669' : '#DC2626', fontWeight: 800 }}>
                          {profitDiff >= 0 ? '+' : ''}{fmtCOP(profitDiff)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )
            })() : null}

            {/* Órdenes por técnico */}
            {chartData?.ordersByTech?.length ? (
              <div className={styles.detailCard}>
                <div className={styles.detailCardHeader}>
                  <h3 className={styles.chartTitle}>Órdenes por técnico</h3>
                  <button type="button" className={styles.miniExport} onClick={() => exportToPDF(
                    'Órdenes por técnico',
                    ['Técnico', 'Total', 'Completadas', 'Activas'],
                    chartData.ordersByTech.map((r) => [r.employee_name, r.total_orders, r.completed, r.active]),
                    'Ordenes_por_tecnico.pdf'
                  )}>PDF</button>
                </div>
                <table className={styles.miniTable}>
                  <thead><tr><th>Técnico</th><th>Total</th><th>Completadas</th><th>Activas</th></tr></thead>
                  <tbody>
                    {chartData.ordersByTech.map((r, i) => (
                      <tr key={i}><td>{r.employee_name}</td><td>{r.total_orders}</td><td>{r.completed}</td><td>{r.active}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {/* Repuestos vendidos */}
            {chartData?.topServices?.length ? (
              <div className={styles.detailCard}>
                <div className={styles.detailCardHeader}>
                  <h3 className={styles.chartTitle}>Repuestos/Servicios vendidos</h3>
                  <button type="button" className={styles.miniExport} onClick={() => exportToPDF(
                    'Servicios vendidos',
                    ['Servicio', 'Veces', 'Ingresos'],
                    chartData.topServices.map((r) => [r.service_name, r.times_sold, fmtCOP(r.revenue)]),
                    'Servicios_vendidos.pdf'
                  )}>PDF</button>
                </div>
                <table className={styles.miniTable}>
                  <thead><tr><th>Servicio</th><th>Vendidos</th><th>Ingresos</th></tr></thead>
                  <tbody>
                    {chartData.topServices.slice(0, 8).map((r, i) => (
                      <tr key={i}><td>{r.service_name}</td><td>{r.times_sold}</td><td>{fmtCOP(r.revenue)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {/* Clientes frecuentes */}
            {chartData?.topClients?.length ? (
              <div className={styles.detailCard}>
                <div className={styles.detailCardHeader}>
                  <h3 className={styles.chartTitle}>Clientes frecuentes</h3>
                  <button type="button" className={styles.miniExport} onClick={() => exportToPDF(
                    'Clientes frecuentes',
                    ['Cliente', 'Órdenes', 'Total gastado'],
                    chartData.topClients.map((r) => [r.client_name, r.orders_count, fmtCOP(r.total_spent)]),
                    'Clientes_frecuentes.pdf'
                  )}>PDF</button>
                </div>
                <table className={styles.miniTable}>
                  <thead><tr><th>Cliente</th><th>Órdenes</th><th>Total</th></tr></thead>
                  <tbody>
                    {chartData.topClients.slice(0, 8).map((r, i) => (
                      <tr key={i}><td>{r.client_name}</td><td>{r.orders_count}</td><td>{fmtCOP(r.total_spent)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {/* Citas atendidas */}
            {chartData?.appointmentsByMonth?.length ? (
              <div className={styles.detailCard}>
                <div className={styles.detailCardHeader}>
                  <h3 className={styles.chartTitle}>Citas atendidas</h3>
                  <button type="button" className={styles.miniExport} onClick={() => exportToPDF(
                    'Citas atendidas',
                    ['Mes', 'Total', 'Atendidas', 'Canceladas', 'Pendientes'],
                    chartData.appointmentsByMonth.map((r) => [r.label, r.total, r.attended, r.cancelled, r.pending]),
                    'Citas_atendidas.pdf'
                  )}>PDF</button>
                </div>
                <table className={styles.miniTable}>
                  <thead><tr><th>Mes</th><th>Total</th><th>Atendidas</th><th>Canceladas</th></tr></thead>
                  <tbody>
                    {chartData.appointmentsByMonth.map((r, i) => (
                      <tr key={i}><td>{r.label}</td><td>{r.total}</td><td>{r.attended}</td><td>{r.cancelled}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </>
      )}

      {/* ── Auditoría ────────────────────────────────── */}
      <AuditoriaPanel />
    </section>
  )
}
