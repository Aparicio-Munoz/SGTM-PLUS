import { getPool } from '../config/database.js'

const BOGOTA_TIME_ZONE = 'America/Bogota'
const ORDER_DELIVERY_DAY = `DATE(CONVERT_TZ(actual_delivery_date, '+00:00', '-05:00'))`
const QUICK_JOB_DAY = `DATE(CONVERT_TZ(q.created_at, '+00:00', '-05:00'))`

// Cada fila representa dinero generado en un día calendario de Bogotá.
// Las órdenes entregadas y los trabajos rápidos se unen aquí para que todos
// los KPIs utilicen exactamente el mismo origen, fechas y fórmula.
//
// La ganancia se calcula con los costos directos registrados: ventas - costo
// de repuestos - comisión de técnicos. No se descuenta nómina fija ni gastos
// operativos porque aún no se registran en la base de datos.
const FINANCIAL_MOVEMENTS_CTE = `
  WITH part_costs AS (
    SELECT
      oi.order_id,
      COALESCE(SUM(oi.quantity * oi.unit_cost), 0) AS parts_cost,
      MAX(oi.cost_is_estimated) AS has_estimated_part_cost
    FROM order_items oi
    GROUP BY oi.order_id
  ),
  financial_movements AS (
    SELECT
      ${ORDER_DELIVERY_DAY} AS business_day,
      o.final_price AS order_revenue,
      0 AS quick_job_revenue,
      COALESCE(pc.parts_cost, 0) AS parts_cost,
      o.final_price * COALESCE(o.technician_commission_percent, 0) / 100 AS technician_commissions,
      0 AS quick_job_payout,
      1 AS delivered_orders,
      0 AS quick_jobs,
      CASE
        WHEN COALESCE(pc.has_estimated_part_cost, 0) = 1
          OR COALESCE(o.commission_is_estimated, 0) = 1
        THEN 1 ELSE 0
      END AS has_estimated_cost
    FROM orders o
    LEFT JOIN part_costs pc ON pc.order_id = o.id
    WHERE o.status = 'Entregada' AND o.actual_delivery_date IS NOT NULL

    UNION ALL

    SELECT
      ${QUICK_JOB_DAY} AS business_day,
      0 AS order_revenue,
      q.price AS quick_job_revenue,
      0 AS parts_cost,
      0 AS technician_commissions,
      q.price * COALESCE(e.commission_percent, 0) / 100 AS quick_job_payout,
      0 AS delivered_orders,
      1 AS quick_jobs,
      0 AS has_estimated_cost
    FROM quick_jobs q
    LEFT JOIN employees e ON e.id = q.employee_id
    WHERE q.deleted_at IS NULL
  )
`

function pad2(value) {
  return String(value).padStart(2, '0')
}

function getBogotaPeriods(now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: BOGOTA_TIME_ZONE }).format(now)
  const [year, month, day] = today.split('-').map(Number)
  const monthStart = `${year}-${pad2(month)}-01`
  const yearStart = `${year}-01-01`
  const fortnightStart = day <= 15 ? monthStart : `${year}-${pad2(month)}-16`
  const date = new Date(Date.UTC(year, month - 1, day))
  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - daysSinceMonday)
  const weekStart = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`

  return { today, year, month, monthStart, yearStart, fortnightStart, weekStart }
}

export function getFinancialPeriodRange(period = 'monthly', now = new Date()) {
  const periods = getBogotaPeriods(now)
  const fromByPeriod = {
    daily: periods.today,
    weekly: periods.weekStart,
    biweekly: periods.fortnightStart,
    monthly: periods.monthStart,
  }

  return { from: fromByPeriod[period] ?? periods.monthStart, to: periods.today }
}

function toNumber(value) {
  return Number(value ?? 0)
}

export function formatFinancialTotals(row = {}) {
  const ordersRevenue = toNumber(row.orders_revenue)
  const quickJobsRevenue = toNumber(row.quick_jobs_revenue)
  const partsCost = toNumber(row.parts_cost)
  const technicianCommissions = toNumber(row.technician_commissions)
  const quickJobPayout = toNumber(row.quick_job_payout)
  const totalRevenue = ordersRevenue + quickJobsRevenue
  const totalDirectCosts = partsCost + technicianCommissions + quickJobPayout

  return {
    ordersRevenue,
    quickJobsRevenue,
    totalRevenue,
    partsCost,
    technicianCommissions,
    quickJobPayout,
    totalDirectCosts,
    profit: totalRevenue - totalDirectCosts,
    profitMargin: totalRevenue > 0 ? ((totalRevenue - totalDirectCosts) / totalRevenue) * 100 : 0,
    deliveredOrders: toNumber(row.delivered_orders),
    quickJobs: toNumber(row.quick_jobs),
    hasEstimatedCosts: toNumber(row.estimated_cost_records) > 0,
  }
}

async function getFinancialTotals(from, to) {
  const [[row]] = await getPool().query(
    `${FINANCIAL_MOVEMENTS_CTE}
     SELECT
       COALESCE(SUM(order_revenue), 0) AS orders_revenue,
       COALESCE(SUM(quick_job_revenue), 0) AS quick_jobs_revenue,
       COALESCE(SUM(parts_cost), 0) AS parts_cost,
       COALESCE(SUM(technician_commissions), 0) AS technician_commissions,
       COALESCE(SUM(quick_job_payout), 0) AS quick_job_payout,
       COALESCE(SUM(delivered_orders), 0) AS delivered_orders,
       COALESCE(SUM(quick_jobs), 0) AS quick_jobs,
       COALESCE(SUM(has_estimated_cost), 0) AS estimated_cost_records
     FROM financial_movements
     WHERE business_day BETWEEN ? AND ?`,
    [from, to]
  )
  return formatFinancialTotals(row)
}

export async function getFinancialSummary() {
  const { today, monthStart, yearStart, fortnightStart } = getBogotaPeriods()
  const [todayTotals, fortnight, month, year, allTime] = await Promise.all([
    getFinancialTotals(today, today),
    getFinancialTotals(fortnightStart, today),
    getFinancialTotals(monthStart, today),
    getFinancialTotals(yearStart, today),
    getFinancialTotals('1900-01-01', today),
  ])

  return { today: todayTotals, fortnight, month, year, allTime }
}

export async function getFinancialHistory(limit = 24) {
  const [rows] = await getPool().query(
    `${FINANCIAL_MOVEMENTS_CTE}
     SELECT
       DATE_FORMAT(business_day, '%Y-%m') AS month,
       COALESCE(SUM(order_revenue), 0) AS orders_revenue,
       COALESCE(SUM(quick_job_revenue), 0) AS quick_jobs_revenue,
       COALESCE(SUM(parts_cost), 0) AS parts_cost,
       COALESCE(SUM(technician_commissions), 0) AS technician_commissions,
       COALESCE(SUM(quick_job_payout), 0) AS quick_job_payout,
       COALESCE(SUM(delivered_orders), 0) AS delivered_orders,
       COALESCE(SUM(quick_jobs), 0) AS quick_jobs,
       COALESCE(SUM(has_estimated_cost), 0) AS estimated_cost_records
     FROM financial_movements
     GROUP BY month
     ORDER BY month DESC
     LIMIT ?`,
    [Number(limit)]
  )

  return rows.map((row) => {
    const [year, month] = row.month.split('-').map(Number)
    return {
      month: row.month,
      label: new Intl.DateTimeFormat('es-CO', {
        month: 'long', year: 'numeric', timeZone: BOGOTA_TIME_ZONE,
      }).format(new Date(Date.UTC(year, month - 1, 1, 5))),
      ...formatFinancialTotals(row),
    }
  })
}

// ── KPIs del dashboard ────────────────────────────────────────
export async function getSummaryData() {
  const pool = getPool()
  const { today } = getBogotaPeriods()

  const [
    [activeRows],
    [todayApptRows],
    [lowStockRows],
    [inServiceRows],
    [completedRows],
    financialToday,
  ] = await Promise.all([
    // Órdenes activas (no entregadas)
    pool.query(
      `SELECT COUNT(*) AS cnt FROM orders WHERE status != 'Entregada'`
    ),
    // Citas de hoy (vista: Pendiente + Confirmada de hoy)
    pool.query(
      `SELECT COUNT(*) AS cnt FROM v_todays_appointments`
    ),
    // Repuestos con stock bajo o agotados
    pool.query(
      `SELECT COUNT(*) AS cnt FROM v_inventory_alerts`
    ),
    // Motos actualmente en el taller
    pool.query(
      `SELECT COUNT(*) AS cnt
       FROM motorcycles
       WHERE status = 'En servicio' AND deleted_at IS NULL`
    ),
    // Órdenes entregadas hoy
    pool.query(
      `SELECT COUNT(*) AS cnt
       FROM orders
       WHERE status = 'Entregada'
         AND ${ORDER_DELIVERY_DAY} = ?`,
      [today]
    ),
    getFinancialTotals(today, today),
  ])

  return {
    activeOrders:         Number(activeRows[0].cnt),
    appointmentsToday:    Number(todayApptRows[0].cnt),
    lowStockItems:        Number(lowStockRows[0].cnt),
    motorcyclesInService: Number(inServiceRows[0].cnt),
    completedToday:       Number(completedRows[0].cnt),
    dailyRevenue:         financialToday.totalRevenue,
    dailyProfit:          financialToday.profit,
  }
}

// ── Ventas por período ────────────────────────────────────────
// period: 'daily' | 'weekly' | 'biweekly' | 'monthly'
export async function getOrdersByPeriod(period = 'monthly') {
  const { from, to } = getFinancialPeriodRange(period)
  const [financial, [salesRows], [quickJobsRows]] = await Promise.all([
    getFinancialTotals(from, to),
    getPool().query(
      `SELECT
         COALESCE(s.id, o.id) AS id, o.id AS order_id, o.order_number,
         o.actual_delivery_date AS sale_date,
         o.final_price AS total,
         o.parts_cost AS parts_subtotal,
         o.labor_cost + o.services_cost AS labor_subtotal,
         o.discount,
         s.payment_method, s.payment_status,
         CONCAT_WS(' ', c.name, c.last_name) AS client_name,
         m.plate AS motorcycle_plate,
         CONCAT_WS(' ', m.brand, m.model) AS motorcycle_info
       FROM orders o
       LEFT JOIN sales s ON s.order_id = o.id
       LEFT JOIN clients c ON c.id = o.client_id
       LEFT JOIN motorcycles m ON m.id = o.motorcycle_id
       WHERE o.status = 'Entregada'
         AND o.actual_delivery_date IS NOT NULL
         AND ${ORDER_DELIVERY_DAY} BETWEEN ? AND ?
       ORDER BY o.actual_delivery_date DESC`,
      [from, to]
    ),
    getPool().query(
      `SELECT id, description, price, employee_id, created_at
       FROM quick_jobs q
       WHERE q.deleted_at IS NULL
         AND ${QUICK_JOB_DAY} BETWEEN ? AND ?
       ORDER BY q.created_at DESC`,
      [from, to]
    ),
  ])

  const orderTotals = salesRows.reduce((totals, sale) => {
    const amount = toNumber(sale.total)
    totals.partsRevenue += toNumber(sale.parts_subtotal)
    totals.laborRevenue += toNumber(sale.labor_subtotal)
    totals.totalDiscounts += toNumber(sale.discount)
    if (sale.payment_status === 'Pagado') totals.collected += amount
    if (sale.payment_status === 'Pendiente') totals.pending += amount
    if (sale.payment_status === 'Parcial') totals.partial += amount
    return totals
  }, {
    partsRevenue: 0,
    laborRevenue: 0,
    totalDiscounts: 0,
    collected: 0,
    pending: 0,
    partial: 0,
  })

  return {
    period,
    summary: {
      totalSales:     financial.deliveredOrders + financial.quickJobs,
      totalRevenue:   financial.totalRevenue,
      partsRevenue:   orderTotals.partsRevenue,
      laborRevenue:   orderTotals.laborRevenue,
      totalDiscounts: orderTotals.totalDiscounts,
      collected:      orderTotals.collected,
      pending:        orderTotals.pending,
      partial:        orderTotals.partial,
      ...financial,
    },
    sales: salesRows,
    quickJobs: quickJobsRows,
  }
}

// ── Top 10 repuestos más usados ───────────────────────────────
export async function getTopParts(limit = 10) {
  const [rows] = await getPool().query(
    `SELECT
       oi.part_name,
       i.code       AS part_code,
       i.brand      AS part_brand,
       i.category,
       SUM(oi.quantity)   AS total_sold,
       SUM(oi.total_price) AS total_revenue
     FROM order_items oi
     LEFT JOIN inventory i ON i.id = oi.inventory_id
     GROUP BY oi.inventory_id, oi.part_name, i.code, i.brand, i.category
     ORDER BY total_sold DESC
     LIMIT ?`,
    [Number(limit)]
  )
  return rows
}

// ── Rendimiento de empleados — usa v_employee_performance ─────
export async function getEmployeePerformance() {
  const pool = getPool()

  // Query principal: datos de la vista (totales históricos + últimos 30 días)
  const [[perfRows], [earningsRows], [quickJobRows]] = await Promise.all([
    pool.query(
      `SELECT
         employee_id, employee_name, specialty,
         daily_rate, employee_status,
         total_orders, completed_orders,
         total_services, services_revenue,
         orders_last_30_days, revenue_last_30_days
       FROM v_employee_performance
       ORDER BY completed_orders DESC`
    ),
    // Ganancias por comisión con granularidad diaria / quincenal / mensual:
    // SUM(labor_cost de las órdenes asignadas en el período) × commission_percent / 100.
    // No incluye repuestos ni servicios — igual que el cálculo de /employees/:id/earnings.
    // entry_date se guarda en hora del servidor (UTC) — se convierte a
    // -05:00 (Bogotá) antes de comparar contra "hoy", igual que en los
    // trabajos rápidos más abajo, para no atribuir mal las órdenes de la
    // noche (7pm-medianoche hora Colombia) al día calendario equivocado.
    pool.query(
      `SELECT
         e.id AS employee_id,
         COALESCE(SUM(
           CASE WHEN DATE(CONVERT_TZ(o.entry_date, '+00:00', '-05:00'))
                     = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-05:00'))
           THEN o.labor_cost END), 0) * e.commission_percent / 100         AS daily_earnings,
         COALESCE(SUM(
           CASE WHEN CONVERT_TZ(o.entry_date, '+00:00', '-05:00')
                     >= DATE_SUB(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-05:00')), INTERVAL 14 DAY)
           THEN o.labor_cost END), 0) * e.commission_percent / 100         AS biweekly_earnings,
         COALESCE(SUM(
           CASE WHEN YEAR(CONVERT_TZ(o.entry_date, '+00:00', '-05:00'))
                      = YEAR(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-05:00'))
                AND  MONTH(CONVERT_TZ(o.entry_date, '+00:00', '-05:00'))
                      = MONTH(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-05:00'))
           THEN o.labor_cost END), 0) * e.commission_percent / 100         AS monthly_earnings
       FROM employees e
       LEFT JOIN orders o ON o.assigned_employee_id = e.id
       WHERE e.deleted_at IS NULL
       GROUP BY e.id, e.commission_percent`
    ),
    // Trabajos rápidos: monto pleno (sin comisión), mismas 3 ventanas.
    // created_at es TIMESTAMP en UTC real (servidor gestionado corre en
    // UTC) — se convierte explícitamente a -05:00 (Bogotá, sin horario de
    // verano) para que "hoy" no se calcule mal entre las 7pm y medianoche
    // hora Colombia.
    pool.query(
      `SELECT
         employee_id,
         COALESCE(SUM(CASE WHEN DATE(CONVERT_TZ(created_at, '+00:00', '-05:00'))
                                = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-05:00'))
                       THEN price END), 0)                                 AS daily_total,
         COALESCE(SUM(CASE WHEN CONVERT_TZ(created_at, '+00:00', '-05:00')
                                >= DATE_SUB(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-05:00')), INTERVAL 14 DAY)
                       THEN price END), 0)                                 AS biweekly_total,
         COALESCE(SUM(CASE WHEN YEAR(CONVERT_TZ(created_at, '+00:00', '-05:00'))
                                 = YEAR(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-05:00'))
                            AND MONTH(CONVERT_TZ(created_at, '+00:00', '-05:00'))
                                 = MONTH(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-05:00'))
                       THEN price END), 0)                                 AS monthly_total
       FROM quick_jobs
       WHERE deleted_at IS NULL
       GROUP BY employee_id`
    ),
  ])

  // Merge earnings into performance rows usando Map
  const earningsMap  = new Map(earningsRows.map((r) => [r.employee_id, r]))
  const quickJobsMap = new Map(quickJobRows.map((r) => [r.employee_id, r]))

  return perfRows.map((emp) => {
    const earn = earningsMap.get(emp.employee_id) ?? {}
    const qj   = quickJobsMap.get(emp.employee_id) ?? {}
    return {
      ...emp,
      daily_earnings:    Number(earn.daily_earnings    ?? 0) + Number(qj.daily_total    ?? 0),
      biweekly_earnings: Number(earn.biweekly_earnings ?? 0) + Number(qj.biweekly_total ?? 0),
      monthly_earnings:  Number(earn.monthly_earnings  ?? 0) + Number(qj.monthly_total  ?? 0),
      daily_rate:        Number(emp.daily_rate),
      services_revenue:  Number(emp.services_revenue ?? 0),
      revenue_last_30_days: Number(emp.revenue_last_30_days ?? 0),
    }
  })
}

// ── Tecnomecánica — usa v_tecnomecanica_status ────────────────
export async function getTecnomecanicaStatus() {
  const pool = getPool()

  const [[summaryRows], [itemRows]] = await Promise.all([
    pool.query(
      `SELECT
         rtm_status,
         COUNT(*) AS count
       FROM v_tecnomecanica_status
       GROUP BY rtm_status`
    ),
    pool.query(
      `SELECT
         motorcycle_id, plate, motorcycle_info, owner_name, owner_phone,
         tecno_id, inspection_date, expiry_date, rtm_number,
         rtm_status, days_remaining
       FROM v_tecnomecanica_status
       ORDER BY days_remaining ASC`
    ),
  ])

  // Construir objeto de resumen indexado por estado
  const summary = { Vigente: 0, 'Próxima a vencer': 0, Vencida: 0 }
  for (const row of summaryRows) {
    summary[row.rtm_status] = Number(row.count)
  }

  return { summary, items: itemRows }
}

// ── Dashboard ejecutivo: KPIs extendidos ─────────────────────
export async function getExecutiveKPIs() {
  const pool = getPool()
  const [
    financial,
    [clientsRow], [motosRow], [activeRow], [deliveredRow],
    [lowStockRow],
    [statusRows],
  ] = await Promise.all([
    getFinancialSummary(),
    pool.query('SELECT COUNT(*) AS cnt FROM clients WHERE deleted_at IS NULL'),
    pool.query('SELECT COUNT(*) AS cnt FROM motorcycles WHERE deleted_at IS NULL'),
    pool.query("SELECT COUNT(*) AS cnt FROM orders WHERE status != 'Entregada'"),
    pool.query("SELECT COUNT(*) AS cnt FROM orders WHERE status = 'Entregada'"),
    pool.query('SELECT COUNT(*) AS cnt FROM inventory WHERE quantity <= min_stock'),
    pool.query(`SELECT status, COUNT(*) AS cnt FROM orders GROUP BY status`),
  ])

  const ordersByStatus = {}
  for (const r of statusRows) ordersByStatus[r.status] = Number(r.cnt)

  return {
    totalClients:      Number(clientsRow[0].cnt),
    totalMotorcycles:  Number(motosRow[0].cnt),
    activeOrders:      Number(activeRow[0].cnt),
    deliveredOrders:   Number(deliveredRow[0].cnt),
    // Campos conservados para consumidores existentes del endpoint.
    monthlyRevenue:    financial.month.totalRevenue,
    yearlyRevenue:     financial.year.totalRevenue,
    dailyRevenue:      financial.today.totalRevenue,
    fortnightRevenue:  financial.fortnight.totalRevenue,
    monthlyProfit:        financial.month.profit,
    yearlyProfit:         financial.year.profit,
    dailyProfit:          financial.today.profit,
    fortnightProfit:      financial.fortnight.profit,
    financial,
    lowStockItems:     Number(lowStockRow[0].cnt),
    ordersByStatus,
  }
}

// ── Dashboard: alertas ───────────────────────────────────────
export async function getDashboardAlerts() {
  const pool = getPool()
  const [lowStock] = await pool.query(`SELECT id, code, name, brand, quantity, min_stock
                                       FROM inventory
                                       WHERE quantity <= min_stock
                                       ORDER BY quantity ASC LIMIT 5`)
  return { lowStock }
}

// ── Chart data: ventas y ganancias mensuales ─────────────────
export async function getMonthlyRevenue() {
  const { year, month: currentMonth, today, yearStart } = getBogotaPeriods()
  const [rows] = await getPool().query(
    `${FINANCIAL_MOVEMENTS_CTE}
     SELECT
       DATE_FORMAT(business_day, '%Y-%m') AS month,
       COALESCE(SUM(order_revenue), 0) AS orders_revenue,
       COALESCE(SUM(quick_job_revenue), 0) AS quick_jobs_revenue,
       COALESCE(SUM(parts_cost), 0) AS parts_cost,
       COALESCE(SUM(technician_commissions), 0) AS technician_commissions,
       COALESCE(SUM(quick_job_payout), 0) AS quick_job_payout,
       COALESCE(SUM(delivered_orders), 0) AS delivered_orders,
       COALESCE(SUM(quick_jobs), 0) AS quick_jobs,
       COALESCE(SUM(has_estimated_cost), 0) AS estimated_cost_records
     FROM financial_movements
     WHERE business_day BETWEEN ? AND ?
     GROUP BY month
     ORDER BY month ASC`,
    [yearStart, today]
  )

  const byMonth = new Map(rows.map((row) => [row.month, row]))
  return Array.from({ length: currentMonth }, (_, index) => {
    const monthNumber = index + 1
    const monthKey = `${year}-${pad2(monthNumber)}`
    const row = byMonth.get(monthKey)
    const label = new Intl.DateTimeFormat('es-CO', {
      month: 'short', year: 'numeric', timeZone: BOGOTA_TIME_ZONE,
    }).format(new Date(Date.UTC(year, index, 1, 5)))

    const totals = formatFinancialTotals(row)
    return {
      month: monthKey,
      label,
      ...totals,
      // Aliases utilizados por las gráficas y exportaciones ya existentes.
      orders_count: toNumber(row?.delivered_orders),
      revenue: totals.totalRevenue,
      profit: totals.profit,
    }
  })
}

// ── Chart data: ingresos diarios del mes en curso ────────────
// Un punto por día 1..N del mes actual (hora Bogotá) — los días sin
// entregas quedan en 0 en vez de faltar, para que el gráfico muestre
// picos y días bajos reales, no solo los días con ventas.
export async function getDailyRevenueThisMonth() {
  const { year, month, monthStart, today } = getBogotaPeriods()
  const [rows] = await getPool().query(
    `${FINANCIAL_MOVEMENTS_CTE}
     SELECT
       DAY(business_day) AS day_number,
       COALESCE(SUM(order_revenue), 0) AS orders_revenue,
       COALESCE(SUM(quick_job_revenue), 0) AS quick_jobs_revenue,
       COALESCE(SUM(parts_cost), 0) AS parts_cost,
       COALESCE(SUM(technician_commissions), 0) AS technician_commissions,
       COALESCE(SUM(quick_job_payout), 0) AS quick_job_payout,
       COALESCE(SUM(delivered_orders), 0) AS delivered_orders,
       COALESCE(SUM(quick_jobs), 0) AS quick_jobs,
       COALESCE(SUM(has_estimated_cost), 0) AS estimated_cost_records
     FROM financial_movements
     WHERE business_day BETWEEN ? AND ?
     GROUP BY day_number
     ORDER BY day_number`,
    [monthStart, today]
  )
  const byDay = new Map(rows.map((row) => [Number(row.day_number), formatFinancialTotals(row)]))
  const daysInMonth = new Date(year, month, 0).getDate()

  return Array.from({ length: daysInMonth }, (_, index) => {
    const totals = byDay.get(index + 1) ?? formatFinancialTotals()
    return {
      day_number: index + 1,
      ...totals,
      revenue: totals.totalRevenue,
      profit: totals.profit,
    }
  })
}

// ── Chart data: comparación quincena 1 vs quincena 2 del mes ──
export async function getFortnightComparison() {
  const { monthStart, today } = getBogotaPeriods()
  const [rows] = await getPool().query(
    `${FINANCIAL_MOVEMENTS_CTE}
     SELECT
       IF(DAY(business_day) <= 15, 'primera', 'segunda') AS fortnight,
       COALESCE(SUM(order_revenue), 0) AS orders_revenue,
       COALESCE(SUM(quick_job_revenue), 0) AS quick_jobs_revenue,
       COALESCE(SUM(parts_cost), 0) AS parts_cost,
       COALESCE(SUM(technician_commissions), 0) AS technician_commissions,
       COALESCE(SUM(quick_job_payout), 0) AS quick_job_payout,
       COALESCE(SUM(delivered_orders), 0) AS delivered_orders,
       COALESCE(SUM(quick_jobs), 0) AS quick_jobs,
       COALESCE(SUM(has_estimated_cost), 0) AS estimated_cost_records
     FROM financial_movements
     WHERE business_day BETWEEN ? AND ?
     GROUP BY fortnight`,
    [monthStart, today]
  )
  const byFortnight = new Map(rows.map((row) => [row.fortnight, formatFinancialTotals(row)]))
  return ['primera', 'segunda'].map((fortnight) => {
    const totals = byFortnight.get(fortnight) ?? formatFinancialTotals()
    return {
      fortnight,
      ...totals,
      orders_count: totals.deliveredOrders,
      revenue: totals.totalRevenue,
      profit: totals.profit,
    }
  })
}

// ── Chart data: servicios más vendidos ────────────────────────
export async function getTopServices(limit = 10) {
  const [rows] = await getPool().query(
    `SELECT
       os.service_name,
       COUNT(*)                        AS times_sold,
       COALESCE(SUM(os.total_price), 0) AS revenue
     FROM order_services os
     GROUP BY os.service_name
     ORDER BY times_sold DESC
     LIMIT ?`,
    [Number(limit)]
  )
  return rows
}

// ── Chart data: top clientes frecuentes ──────────────────────
export async function getTopClients(limit = 10) {
  const [rows] = await getPool().query(
    `SELECT
       CONCAT_WS(' ', c.name, c.last_name) AS client_name,
       c.phone,
       COUNT(o.id)                       AS orders_count,
       COALESCE(SUM(o.final_price), 0)  AS total_spent
     FROM orders o
     INNER JOIN clients c ON c.id = o.client_id
     WHERE c.deleted_at IS NULL
     GROUP BY c.id, c.name, c.last_name, c.phone
     ORDER BY orders_count DESC
     LIMIT ?`,
    [Number(limit)]
  )
  return rows
}

// ── Chart data: stock por categoría ──────────────────────────
export async function getStockByCategory() {
  const [rows] = await getPool().query(
    `SELECT
       category,
       COUNT(*)                      AS items_count,
       COALESCE(SUM(quantity), 0)    AS total_stock,
       COUNT(CASE WHEN quantity = 0 THEN 1 END)       AS out_of_stock,
       COUNT(CASE WHEN quantity <= min_stock AND quantity > 0 THEN 1 END) AS low_stock
     FROM inventory
     GROUP BY category
     ORDER BY category ASC`
  )
  return rows
}

// ── Chart data: órdenes por técnico ──────────────────────────
export async function getOrdersByTechnician() {
  const [rows] = await getPool().query(
    `SELECT
       CONCAT(e.name, ' ', e.last_name) AS employee_name,
       e.specialty,
       COUNT(o.id)                                         AS total_orders,
       COUNT(CASE WHEN o.status = 'Entregada' THEN 1 END) AS completed,
       COUNT(CASE WHEN o.status != 'Entregada' THEN 1 END) AS active
     FROM orders o
     INNER JOIN employees e ON e.id = o.assigned_employee_id AND e.deleted_at IS NULL
     GROUP BY e.id, e.name, e.last_name, e.specialty
     ORDER BY total_orders DESC`
  )
  return rows
}

// ── Chart data: citas atendidas por mes ──────────────────────
export async function getAppointmentsByMonth() {
  const [rows] = await getPool().query(
    `SELECT
       DATE_FORMAT(requested_date, '%Y-%m')  AS month,
       DATE_FORMAT(requested_date, '%b %Y')  AS label,
       COUNT(*)                               AS total,
       COUNT(CASE WHEN status = 'Atendida' THEN 1 END)   AS attended,
       COUNT(CASE WHEN status = 'Cancelada' THEN 1 END)  AS cancelled,
       COUNT(CASE WHEN status = 'Pendiente' THEN 1 END)  AS pending
     FROM appointments
     WHERE requested_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
     GROUP BY month, label
     ORDER BY month ASC`
  )
  return rows
}

// ── Alertas de inventario — usa v_inventory_alerts ────────────
export async function getInventoryAlerts() {
  const pool = getPool()

  const [[statusRows], [itemRows]] = await Promise.all([
    pool.query(
      `SELECT
         status,
         COUNT(*)                        AS count,
         COALESCE(SUM(units_needed), 0)          AS total_units_needed,
         COALESCE(SUM(estimated_restock_cost), 0) AS total_restock_cost
       FROM v_inventory_alerts
       GROUP BY status`
    ),
    pool.query(
      `SELECT
         id, code, name, brand, category,
         quantity, min_stock, status,
         unit_price, supplier,
         units_needed, estimated_restock_cost
       FROM v_inventory_alerts
       ORDER BY quantity ASC, name ASC`
    ),
  ])

  // Construir summary con totales de reabastecimiento
  const summary = {
    'Stock bajo': { count: 0, totalUnitsNeeded: 0, totalRestockCost: 0 },
    'Agotado':    { count: 0, totalUnitsNeeded: 0, totalRestockCost: 0 },
  }
  let globalRestockCost = 0

  for (const row of statusRows) {
    if (summary[row.status]) {
      summary[row.status].count            = Number(row.count)
      summary[row.status].totalUnitsNeeded = Number(row.total_units_needed)
      summary[row.status].totalRestockCost = Number(row.total_restock_cost)
    }
    globalRestockCost += Number(row.total_restock_cost)
  }

  return {
    summary: {
      ...summary,
      totalRestockCost: globalRestockCost,
    },
    items: itemRows,
  }
}
