import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { formatFinancialTotals, getFinancialPeriodRange } from '../src/models/report.model.js'

test('una orden descuenta repuestos y comisión del técnico sobre el total cobrado', () => {
  const totals = formatFinancialTotals({
    orders_revenue: 200_000,
    parts_cost: 50_000,
    technician_commissions: 40_000,
  })

  assert.equal(totals.profit, 110_000)
})

test('una orden sin repuestos descuenta solo la comisión configurada', () => {
  const totals = formatFinancialTotals({
    orders_revenue: 100_000,
    technician_commissions: 10_000,
  })

  assert.equal(totals.profit, 90_000)
})

test('una orden sin técnico no descuenta comisión', () => {
  const totals = formatFinancialTotals({
    orders_revenue: 100_000,
    parts_cost: 20_000,
    technician_commissions: 0,
  })

  assert.equal(totals.profit, 80_000)
})

test('el mes nuevo comienza en cero y no incluye operaciones del mes anterior', () => {
  const octoberFirst = new Date('2026-10-01T12:00:00.000Z')
  const range = getFinancialPeriodRange('monthly', octoberFirst)

  assert.deepEqual(range, { from: '2026-10-01', to: '2026-10-01' })
  assert.equal(formatFinancialTotals({}).profit, 0)
})

test('la consulta agrega repuestos antes de calcular la orden y no duplica ventas', async () => {
  const source = await readFile(new URL('../src/models/report.model.js', import.meta.url), 'utf8')

  assert.match(source, /GROUP BY oi\.order_id/)
  assert.match(source, /o\.final_price \* COALESCE\(o\.technician_commission_percent, 0\) \/ 100/)
  assert.match(source, /LEFT JOIN part_costs pc ON pc\.order_id = o\.id/)
})
