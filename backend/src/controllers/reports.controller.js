import { ApiResponse } from '../utils/ApiResponse.js'
import * as ReportService from '../services/reports.service.js'

export async function getSummary(req, res, next) {
  try {
    const data = await ReportService.getSummary()
    ApiResponse.success(res, data)
  } catch (err) { next(err) }
}

export async function getOrdersByPeriod(req, res, next) {
  try {
    const { period = 'monthly' } = req.query
    const data = await ReportService.getOrdersByPeriod(period)
    ApiResponse.success(res, data)
  } catch (err) { next(err) }
}

export async function getFinancialHistory(req, res, next) {
  try {
    const { limit } = req.query
    const data = await ReportService.getFinancialHistory(limit)
    ApiResponse.success(res, data)
  } catch (err) { next(err) }
}

export async function getTopParts(req, res, next) {
  try {
    const { limit = 10 } = req.query
    const data = await ReportService.getTopParts({ limit })
    ApiResponse.success(res, data)
  } catch (err) { next(err) }
}

export async function getEmployeeStats(req, res, next) {
  try {
    const data = await ReportService.getEmployeeStats()
    ApiResponse.success(res, data)
  } catch (err) { next(err) }
}

export async function getTecnomecanica(req, res, next) {
  try {
    const data = await ReportService.getTecnomecanica()
    ApiResponse.success(res, data)
  } catch (err) { next(err) }
}

export async function getInventoryAlerts(req, res, next) {
  try {
    const data = await ReportService.getInventoryAlerts()
    ApiResponse.success(res, data)
  } catch (err) { next(err) }
}

export async function getAuditLogs(req, res, next) {
  try {
    const { search, date_from, date_to, user_id, action, table_name, page, limit } = req.query
    const result = await ReportService.getAuditLogs({
      search, date_from, date_to, user_id, action, table_name, page, limit,
    })
    ApiResponse.paginated(res, result.data, result)
  } catch (err) { next(err) }
}

export async function getAuditActions(req, res, next) {
  try {
    const data = await ReportService.getAuditActions()
    ApiResponse.success(res, data)
  } catch (err) { next(err) }
}

export async function getAuditTables(req, res, next) {
  try {
    const data = await ReportService.getAuditTables()
    ApiResponse.success(res, data)
  } catch (err) { next(err) }
}

export async function getExecutiveDashboard(req, res, next) {
  try {
    const data = await ReportService.getExecutiveDashboard()
    ApiResponse.success(res, data)
  } catch (err) { next(err) }
}

export async function getChartData(req, res, next) {
  try {
    const data = await ReportService.getChartData()
    ApiResponse.success(res, data)
  } catch (err) { next(err) }
}
