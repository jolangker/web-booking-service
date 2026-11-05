import puppeteer from 'puppeteer-core'
import { invoiceHtml } from '@booking/core'
import type { InvoiceSnapshot } from '@booking/core'

export async function renderInvoice(snapshot: InvoiceSnapshot) {
  const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/chromium'),
    headless: true, timeout: 20000, args: process.env.PUPPETEER_DISABLE_SANDBOX === 'true' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] })
  try {
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    page.on('request', request => { void request.abort() })
    await page.setContent(invoiceHtml(snapshot), { waitUntil: 'load', timeout: 20000 })
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, timeout: 30000,
      margin: { top: '16mm', bottom: '20mm', left: '14mm', right: '14mm' }, displayHeaderFooter: true,
      headerTemplate: '<span></span>', footerTemplate: '<div style="font:9px Arial;width:100%;text-align:center;color:#52606d">Halaman <span class="pageNumber"></span> / <span class="totalPages"></span></div>' })
  } finally { await browser.close() }
}
