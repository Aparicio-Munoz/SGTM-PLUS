import { Router } from 'express'
import { verifyToken, requireRole } from '../middlewares/auth.middleware.js'
import * as ReportController from '../controllers/reports.controller.js'

const router = Router()
router.use(verifyToken)
// Reportes financieros/operativos: solo Administrador
router.use(requireRole('Administrador'))

// GET /api/reports/summary         → KPIs generales (órdenes activas, ingresos, etc.)
// GET /api/reports/orders          → Órdenes por período (?period=today|week|month)
// GET /api/reports/top-parts       → Top repuestos más usados
// GET /api/reports/employees       → Productividad por empleado
// GET /api/reports/tecnomecanica   → Estado tecnomecánica de motocicletas
// GET /api/reports/inventory-alerts → Repuestos bajo stock mínimo

router.get('/summary',           ReportController.getSummary)
router.get('/executive',         ReportController.getExecutiveDashboard)
router.get('/orders',            ReportController.getOrdersByPeriod)
router.get('/financial-history', ReportController.getFinancialHistory)
router.get('/top-parts',         ReportController.getTopParts)
router.get('/employees',         ReportController.getEmployeeStats)
router.get('/tecnomecanica',     ReportController.getTecnomecanica)
router.get('/inventory-alerts',  ReportController.getInventoryAlerts)

// GET /api/reports/chart-data    → datos para las gráficas del dashboard
router.get('/chart-data',        ReportController.getChartData)

// GET /api/reports/audit-logs   → auditoría con filtros (date_from, date_to, user_id, action, page, limit)
// GET /api/reports/audit-actions → lista de acciones distintas registradas
router.get('/audit-logs',        ReportController.getAuditLogs)
router.get('/audit-actions',     ReportController.getAuditActions)
router.get('/audit-tables',      ReportController.getAuditTables)

export default router
