import type { Database } from '@booking/db'
import { dateString, DomainError, integer, object, TIMEZONE } from './workshop.js'

export function reportPeriod(value: unknown) {
  const v = object(value)
  if (v.mode !== 'daily' && v.mode !== 'monthly') throw new DomainError(422, 'Periode harus harian atau bulanan.')
  if (typeof v.period !== 'string' || !(v.mode === 'daily' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/).test(v.period)) throw new DomainError(422, 'Format periode tidak valid.')
  const startDate = dateString(v.mode === 'daily' ? v.period : `${v.period}-01`)
  if (Number(startDate.slice(0, 4)) < 1) throw new DomainError(422, 'Tahun periode harus 0001–9999.')
  const end = new Date(`${startDate}T00:00:00Z`)
  if (v.mode === 'daily') end.setUTCDate(end.getUTCDate() + 1)
  else end.setUTCMonth(end.getUTCMonth() + 1)
  const endDate = end.toISOString().split('T')[0]!.replace(/^\+0/, '')
  function page(value: unknown, label: string) {
    if (value === undefined) return 1
    if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value)) throw new DomainError(422, `${label} tidak valid.`)
    return integer(Number(value), label, 1, 100000)
  }
  return { mode: v.mode, period: v.period, timezone: TIMEZONE, startDate, endDate,
    visitPage: page(v.visitPage, 'Halaman kunjungan'), paymentPage: page(v.paymentPage, 'Halaman transaksi'), pageSize: 50 }
}

interface Amounts { transactions: number, serviceSubtotal: number, partSubtotal: number, total: number }
export interface OperationalReport {
  period: ReturnType<typeof reportPeriod>
  summary: Amounts & { visits: number, uniqueVehicles: number }
  methods: (Amounts & { method: 'cash' | 'qris' | 'edc' })[]
  visits: { bookingId: string, code: string, vehicle: { plate: string }, checkedInAt: string, status: string }[]
  payments: { paymentId: string, bookingId: string, invoiceId: string, number: string, vehicle: { plate: string },
    paidAt: string, method: 'cash' | 'qris' | 'edc', reference: string, serviceSubtotal: number, partSubtotal: number, total: number }[]
}

// One statement gives summaries and both pages the same MVCC snapshot. Aggregate invoice
// lines per payment before any counts/sums; neither visits nor payments can multiply.
export async function operationalReport(database: Database, value: unknown): Promise<OperationalReport> {
  const period = reportPeriod(value)
  const { rows: [result] } = await database.pool.query(`WITH bounds AS (
      SELECT $1::date::timestamp AT TIME ZONE $3 AS start_at,$2::date::timestamp AT TIME ZONE $3 AS end_at
    ), visits AS MATERIALIZED (
      SELECT b.id AS "bookingId",b.code,b.vehicle_id,b.vehicle_snapshot AS vehicle,b.checked_in_at AS "checkedInAt",b.status
      FROM app.bookings b,bounds WHERE b.reservation_status='active'
      AND b.checked_in_at>=bounds.start_at AND b.checked_in_at<bounds.end_at
    ), paid AS MATERIALIZED (
      SELECT p.id AS "paymentId",p.booking_id AS "bookingId",i.id AS "invoiceId",i.number,
        i.snapshot->'vehicle' AS vehicle,p.paid_at AS "paidAt",p.method,p.reference,p.total,
        COALESCE(l.service,0) AS "serviceSubtotal",COALESCE(l.part,0) AS "partSubtotal"
      FROM app.payments p JOIN app.invoices i ON i.payment_id=p.id
      CROSS JOIN bounds LEFT JOIN LATERAL (
        SELECT sum(quantity::bigint*unit_price) FILTER(WHERE kind='service') AS service,
          sum(quantity::bigint*unit_price) FILTER(WHERE kind='part') AS part
        FROM app.invoice_lines WHERE invoice_id=i.id
      ) l ON true WHERE p.status='paid' AND p.paid_at>=bounds.start_at AND p.paid_at<bounds.end_at
    ) SELECT jsonb_build_object(
      'visits',(SELECT count(*) FROM visits),'uniqueVehicles',(SELECT count(DISTINCT vehicle_id) FROM visits),
      'transactions',count(*),'serviceSubtotal',COALESCE(sum("serviceSubtotal"),0),
      'partSubtotal',COALESCE(sum("partSubtotal"),0),'total',COALESCE(sum(total::bigint),0)) AS summary,
      (SELECT COALESCE(jsonb_agg(m ORDER BY method),'[]'::jsonb) FROM (
        SELECT method,count(*) AS transactions,COALESCE(sum("serviceSubtotal"),0) AS "serviceSubtotal",
          COALESCE(sum("partSubtotal"),0) AS "partSubtotal",sum(total::bigint) AS total FROM paid GROUP BY method
      ) m) AS methods,
      (SELECT COALESCE(jsonb_agg(v ORDER BY "checkedInAt" DESC,"bookingId" DESC),'[]'::jsonb) FROM (
        SELECT "bookingId",code,vehicle,"checkedInAt",status FROM visits ORDER BY "checkedInAt" DESC,"bookingId" DESC LIMIT 50 OFFSET $4
      ) v) AS visits,
      (SELECT COALESCE(jsonb_agg(p ORDER BY "paidAt" DESC,"paymentId" DESC),'[]'::jsonb) FROM (
        SELECT * FROM paid ORDER BY "paidAt" DESC,"paymentId" DESC LIMIT 50 OFFSET $5
      ) p) AS payments FROM paid`, [period.startDate, period.endDate, period.timezone, (period.visitPage - 1) * period.pageSize, (period.paymentPage - 1) * period.pageSize])
  return { period, ...result }
}
