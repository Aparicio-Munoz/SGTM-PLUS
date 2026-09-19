import { apiClient } from './apiClient'

export const reportsApi = {
  // GET /reports/summary → { activeOrders, appointmentsToday, lowStockItems, ... }
  getSummary() {
    return apiClient.get('/reports/summary').then((r) => r.data.data)
  },

  // GET /reports/orders?period=daily|weekly|biweekly|monthly
  getOrdersByPeriod(period = 'monthly') {
    return apiClient.get('/reports/orders', { params: { period } }).then((r) => r.data.data)
  },

  // GET /reports/financial-history?limit=24 → resumen mensual calculado desde operaciones reales.
  getFinancialHistory(limit = 24) {
    return apiClient.get('/reports/financial-history', { params: { limit } }).then((r) => r.data.data)
  },

  // GET /reports/top-parts?limit=10
  getTopParts(limit = 10) {
    return apiClient.get('/reports/top-parts', { params: { limit } }).then((r) => r.data.data)
  },

  // GET /reports/employees
  getEmployeeStats() {
    return apiClient.get('/reports/employees').then((r) => r.data.data)
  },

  // GET /reports/tecnomecanica → { summary, items }
  getTecnomecanica() {
    return apiClient.get('/reports/tecnomecanica').then((r) => r.data.data)
  },

  // GET /reports/inventory-alerts → { summary, items }
  getInventoryAlerts() {
    return apiClient.get('/reports/inventory-alerts').then((r) => r.data.data)
  },

  // GET /reports/executive → { kpis, charts, alerts }
  getExecutiveDashboard(config = {}) {
    return apiClient.get('/reports/executive', config).then((r) => r.data.data)
  },

  // GET /reports/chart-data → { monthlyRevenue, topServices, topClients, stockByCategory, ordersByTech, appointmentsByMonth }
  getChartData() {
    return apiClient.get('/reports/chart-data').then((r) => r.data.data)
  },

  // GET /reports/audit-logs?search=&date_from=&date_to=&user_id=&action=&table_name=&page=&limit=
  getAuditLogs(params = {}) {
    return apiClient.get('/reports/audit-logs', { params }).then((r) => r.data)
  },

  // GET /reports/audit-actions → string[]
  getAuditActions() {
    return apiClient.get('/reports/audit-actions').then((r) => r.data.data)
  },

  // GET /reports/audit-tables → string[]
  getAuditTables() {
    return apiClient.get('/reports/audit-tables').then((r) => r.data.data)
  },
}
