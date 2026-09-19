import { ApiError } from '../utils/ApiError.js'
import * as ReportModel from '../models/report.model.js'
import * as AuditLogModel from '../models/auditLog.model.js'

const VALID_PERIODS = ['daily', 'weekly', 'biweekly', 'monthly']
const DEFAULT_FINANCIAL_HISTORY_LIMIT = 24
const MAX_FINANCIAL_HISTORY_LIMIT = 60

// ── Auditoría ─────────────────────────────────────────────────
export async function getAuditLogs(query = {}) {
  const { search, date_from, date_to, user_id, action, table_name, page = 1, limit = 20 } = query
  const { rows, total } = await AuditLogModel.findAll({
    search, date_from, date_to, user_id, action, table_name, page, limit,
  })
  return { data: rows, total: Number(total), page: Number(page), limit: Number(limit) }
}

export async function getAuditActions() {
  return AuditLogModel.findDistinctActions()
}

export async function getAuditTables() {
  return AuditLogModel.findDistinctTables()
}

// ── Dashboard KPIs ────────────────────────────────────────────
export async function getSummary() {
  return ReportModel.getSummaryData()
}

export async function getExecutiveDashboard() {
  const [kpis, charts, alerts] = await Promise.all([
    ReportModel.getExecutiveKPIs(),
    ReportModel.getMonthlyRevenue().then(async (monthlyRevenue) => {
      const [topServices, topClients, stockByCategory, ordersByTech] = await Promise.all([
        ReportModel.getTopServices(8),
        ReportModel.getTopClients(8),
        ReportModel.getStockByCategory(),
        ReportModel.getOrdersByTechnician(),
      ])
      return { monthlyRevenue, topServices, topClients, stockByCategory, ordersByTech }
    }),
    ReportModel.getDashboardAlerts(),
  ])
  return { kpis, charts, alerts }
}

// ── Ventas por período ────────────────────────────────────────
export async function getOrdersByPeriod(period = 'monthly') {
  if (period && !VALID_PERIODS.includes(period)) {
    throw ApiError.badRequest(
      `Período inválido — valores válidos: ${VALID_PERIODS.join(', ')}`
    )
  }
  return ReportModel.getOrdersByPeriod(period ?? 'monthly')
}

export async function getFinancialHistory(limit = DEFAULT_FINANCIAL_HISTORY_LIMIT) {
  const parsedLimit = Number(limit)
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_FINANCIAL_HISTORY_LIMIT) {
    throw ApiError.badRequest(`limit debe ser un número entero entre 1 y ${MAX_FINANCIAL_HISTORY_LIMIT}`)
  }
  return ReportModel.getFinancialHistory(parsedLimit)
}

// ── Top repuestos ─────────────────────────────────────────────
export async function getTopParts({ limit = 10 } = {}) {
  const n = Number(limit)
  if (isNaN(n) || n < 1 || n > 50) {
    throw ApiError.badRequest('limit debe ser un número entre 1 y 50')
  }
  return ReportModel.getTopParts(n)
}

// ── Rendimiento de empleados ──────────────────────────────────
export async function getEmployeeStats() {
  return ReportModel.getEmployeePerformance()
}

// ── Estado tecnomecánica ──────────────────────────────────────
export async function getTecnomecanica() {
  return ReportModel.getTecnomecanicaStatus()
}

// ── Alertas de inventario ─────────────────────────────────────
export async function getInventoryAlerts() {
  return ReportModel.getInventoryAlerts()
}

// ── Chart data ───────────────────────────────────────────────
export async function getChartData() {
  const [
    monthlyRevenue, topServices, topClients, stockByCategory, ordersByTech, appointmentsByMonth,
    dailyRevenueThisMonth, fortnightComparison, financialSummary,
  ] = await Promise.all([
    ReportModel.getMonthlyRevenue(),
    ReportModel.getTopServices(10),
    ReportModel.getTopClients(10),
    ReportModel.getStockByCategory(),
    ReportModel.getOrdersByTechnician(),
    ReportModel.getAppointmentsByMonth(),
    ReportModel.getDailyRevenueThisMonth(),
    ReportModel.getFortnightComparison(),
    ReportModel.getFinancialSummary(),
  ])

  return {
    monthlyRevenue, topServices, topClients, stockByCategory, ordersByTech, appointmentsByMonth,
    dailyRevenueThisMonth, fortnightComparison, financialSummary,
  }
}
