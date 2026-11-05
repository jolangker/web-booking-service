import type { Database } from '@booking/db'
import type { Environment } from './env.js'
import { uuid } from './customer.js'
import { getInvoice, invoiceFile } from './invoice.js'
import { DomainError, integer } from './workshop.js'

// Only exact, known customer pages may survive login. Never accept an origin, query or fragment.
export function customerReturnPath(value: unknown) {
  if (typeof value !== 'string') return '/account'
  return /^\/(?:account|bookings(?:\/new|\/[0-9a-f-]{36})?|history(?:\/[0-9a-f-]{36})?|invoices\/[0-9a-f-]{36})$/.test(value) ? value : '/account'
}

export async function historyVehicles(database: Database, owner: string) {
  return { vehicles: (await database.pool.query(`SELECT v.id,v.plate,v.brand,v.model,v.year,
    (SELECT count(*)::int FROM app.service_archives a WHERE a.vehicle_id=v.id AND a.customer_id=$1) AS visits
    FROM app.vehicles v WHERE v.customer_id=$1
    UNION ALL SELECT a.vehicle_id,a.snapshot->'vehicle'->>'plate',a.snapshot->'vehicle'->>'brand',
    a.snapshot->'vehicle'->>'model',(a.snapshot->'vehicle'->>'year')::int,
    (SELECT count(*)::int FROM app.service_archives x WHERE x.vehicle_id=a.vehicle_id AND x.customer_id=$1)
    FROM app.service_archives a JOIN app.vehicles v ON v.id=a.vehicle_id WHERE a.customer_id=$1 AND v.customer_id<>$1
    AND a.id=(SELECT x.id FROM app.service_archives x WHERE x.customer_id=$1 AND x.vehicle_id=a.vehicle_id ORDER BY x.archived_at DESC,x.id DESC LIMIT 1)
    ORDER BY 1`, [uuid(owner)])).rows }
}

export async function vehicleHistory(database: Database, owner: string, id: unknown, page: unknown = 1) {
  const customerId = uuid(owner), vehicleId = uuid(id), currentPage = integer(Number(page), 'Halaman', 1, 1000000)
  const { rows: [vehicle] } = await database.pool.query(`SELECT id,plate,brand,model,year FROM app.vehicles WHERE id=$1 AND customer_id=$2
    UNION ALL SELECT vehicle_id,snapshot->'vehicle'->>'plate',snapshot->'vehicle'->>'brand',snapshot->'vehicle'->>'model',
    (snapshot->'vehicle'->>'year')::int FROM app.service_archives WHERE vehicle_id=$1 AND customer_id=$2 LIMIT 1`, [vehicleId, customerId])
  if (!vehicle) throw new DomainError(404, 'Kendaraan tidak ditemukan.')
  const { rows } = await database.pool.query(`SELECT a.id,a.invoice_id AS "invoiceId",a.snapshot->>'number' AS number,
    a.snapshot->>'paidAt' AS "paidAt",a.snapshot->'vehicle' AS vehicle,a.snapshot->'odometer' AS odometer,
    a.snapshot->'total' AS total,a.snapshot->'lines' AS lines,i.status AS "pdfStatus"
    FROM app.service_archives a JOIN app.invoices i ON i.id=a.invoice_id WHERE a.customer_id=$1 AND a.vehicle_id=$2
    ORDER BY a.archived_at DESC,a.id DESC LIMIT 51 OFFSET $3`, [customerId, vehicleId, (currentPage - 1) * 50])
  return { vehicle, visits: rows.slice(0, 50), page: currentPage, hasMore: rows.length > 50 }
}

async function ownedArchive(database: Database, owner: string, invoice: unknown) {
  const { rows: [archive] } = await database.pool.query(`SELECT invoice_id AS "invoiceId",vehicle_id AS "vehicleId",snapshot FROM app.service_archives
    WHERE invoice_id=$1 AND customer_id=$2`, [uuid(invoice), uuid(owner)])
  if (!archive) throw new DomainError(404, 'Invoice tidak ditemukan.')
  return archive
}
export async function customerInvoice(database: Database, owner: string, id: unknown) {
  const archive = await ownedArchive(database, owner, id)
  const { invoice } = await getInvoice(database, archive.invoiceId)
  // Expose the archived work only, never mutable live WO or internal actor/idempotency data.
  const s = archive.snapshot, w = s.workOrder
  return { invoice: { id: invoice.id, number: invoice.number, status: invoice.status, snapshot: invoice.snapshot },
    visit: { vehicleId: archive.vehicleId, complaint: s.complaint, scheduledAt: s.scheduledAt, receivedAt: w.received_at,
      diagnosis: w.diagnosis, inspection: w.inspection, initialCondition: w.initial_condition, notes: s.notes,
      history: s.history.map((h: { action: string, occurred_at: string }) => ({ action: h.action, occurredAt: h.occurred_at })) } }
}
export async function customerInvoiceFile(database: Database, env: Environment, owner: string, id: unknown) {
  const archive = await ownedArchive(database, owner, id)
  return invoiceFile(database, env, archive.invoiceId)
}
