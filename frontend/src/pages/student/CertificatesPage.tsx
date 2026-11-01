import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Award, CalendarDays, Download, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate } from '@/lib/utils'
import type { Certificate } from '@/types'
import { EmptyState, ErrorState, PageHeader } from '@/components/shared/PageChrome'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonStyles } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character)
}

function certificateDocument(certificate: Certificate, studentName: string) {
  const eventTitle = escapeHtml(certificate.eventTitle)
  const clubName = escapeHtml(certificate.clubName)
  const recipient = escapeHtml(studentName)
  const code = escapeHtml(certificate.certificateCode)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Certificate ${code} · CampusConnect</title>
  <style>
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px;
      background: #ece9e0;
      color: #0a1210;
      font-family: 'Plus Jakarta Sans', 'Segoe UI', Helvetica, Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 100%;
      max-width: 1040px;
      padding: 18px;
      background: #fffdf7;
      border: 1px solid #d4ded9;
      box-shadow: 0 24px 60px -30px rgba(10, 18, 16, 0.35);
    }
    .frame {
      position: relative;
      padding: 44px 56px 34px;
      border: 2px solid #0a6f46;
    }
    .frame::before {
      content: '';
      position: absolute;
      inset: 8px;
      border: 1px solid #cfe6d9;
      pointer-events: none;
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: #0a6f46;
    }
    .brand span:last-child { color: #889a93; letter-spacing: 0.16em; }
    .rule {
      height: 4px;
      margin: 18px 0 30px;
      background: linear-gradient(90deg, #0a6f46 0%, #17ad69 45%, #dcf86a 100%);
    }
    .kicker {
      margin: 0;
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: #667972;
    }
    h1.title {
      margin: 14px 0 0;
      text-align: center;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 54px;
      font-weight: 400;
      line-height: 1.02;
      letter-spacing: -0.02em;
    }
    .presented {
      margin: 26px 0 0;
      text-align: center;
      font-size: 12px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #667972;
    }
    .name {
      margin: 10px 0 0;
      text-align: center;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 40px;
      font-style: italic;
      line-height: 1.1;
      color: #0a6f46;
    }
    .name-rule {
      width: 260px;
      height: 1px;
      margin: 16px auto 0;
      background: #b3c2bc;
    }
    .recognition {
      max-width: 620px;
      margin: 22px auto 0;
      text-align: center;
      font-size: 13px;
      line-height: 1.7;
      color: #4c5f58;
    }
    .event {
      max-width: 760px;
      margin: 8px auto 0;
      text-align: center;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 28px;
      line-height: 1.2;
      color: #0a1210;
    }
    .club {
      margin: 8px 0 0;
      text-align: center;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #0a6f46;
    }
    .meta {
      display: flex;
      justify-content: center;
      gap: 48px;
      margin: 28px 0 0;
      padding-top: 20px;
      border-top: 1px solid #e8eeeb;
    }
    .meta div { text-align: center; }
    .meta dt {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #889a93;
    }
    .meta dd {
      margin: 5px 0 0;
      font-size: 12px;
      font-weight: 600;
      color: #26332e;
    }
    .footer {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 30px;
      margin-top: 38px;
    }
    .code-label {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #889a93;
    }
    .code {
      margin-top: 5px;
      font-family: 'Courier New', monospace;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.12em;
      color: #0a6f46;
    }
    .signature { min-width: 220px; text-align: center; }
    .signature-line { display: block; width: 200px; height: 1px; background: #26332e; }
    .signature-label {
      display: block;
      margin-top: 7px;
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #667972;
    }
    .note {
      margin: 22px 0 0;
      text-align: center;
      font-size: 9px;
      letter-spacing: 0.05em;
      color: #889a93;
    }
    @media print {
      body { display: block; padding: 0; background: #ffffff; }
      .sheet { max-width: none; padding: 0; border: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <div class="frame">
      <div class="brand"><span>CampusConnect</span><span>Student life · Certificates</span></div>
      <div class="rule"></div>

      <p class="kicker">Certificate of participation</p>
      <h1 class="title">This is to certify that</h1>

      <p class="presented">Presented to</p>
      <p class="name">${recipient}</p>
      <div class="name-rule"></div>

      <p class="recognition">
        for taking part in <strong>${eventTitle}</strong> and contributing to the life of the campus community.
      </p>
      <p class="club">Organised by ${clubName}</p>

      <dl class="meta">
        <div><dt>Event date</dt><dd>${escapeHtml(formatDate(certificate.eventDate, 'EEEE, d MMMM yyyy'))}</dd></div>
        <div><dt>Issued</dt><dd>${escapeHtml(formatDate(certificate.issueDate, 'd MMMM yyyy'))}</dd></div>
      </dl>

      <div class="footer">
        <div>
          <p class="code-label">Certificate code</p>
          <p class="code">${code}</p>
        </div>
        <div class="signature">
          <span class="signature-line"></span>
          <span class="signature-label">Programme coordinator</span>
        </div>
      </div>

      <p class="note">This certificate was issued by CampusConnect. Verify it with the certificate code above.</p>
    </div>
  </main>
</body>
</html>`
}

export default function StudentCertificatesPage() {
  usePageTitle('Certificates')
  const { user } = useAuth()

  const certificates = useQuery({
    queryKey: ['my-certificates'],
    queryFn: () => api.get<Certificate[]>('/me/certificates'),
  })

  const items = [...(certificates.data ?? [])].sort(
    (a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime(),
  )
  const studentName = user?.student?.fullName ?? items[0]?.studentName ?? user?.email ?? 'Student'

  const downloadCertificate = (certificate: Certificate) => {
    const html = certificateDocument(certificate, user?.student?.fullName ?? certificate.studentName)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const printWindow = window.open(url, '_blank')

    if (!printWindow) {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `campusconnect-certificate-${certificate.certificateCode}.html`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast.success('Certificate downloaded', {
        description: 'Open the file in a browser to print it or save it as a PDF.',
      })
      return
    }

    let printed = false
    const triggerPrint = () => {
      if (printed) return
      printed = true
      try {
        printWindow.focus()
        printWindow.print()
      } catch {
        // The document stays open so it can still be printed manually.
      }
    }

    printWindow.onload = triggerPrint
    window.setTimeout(triggerPrint, 700)
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    toast.success('Certificate ready', {
      description: 'Print it or save it as a PDF from the new tab.',
    })
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Student portal"
        title="Certificates"
        description="A record of the events you showed up for. Download, print, or save each certificate as a PDF."
        actions={
          <Link to="/student/events" className={buttonStyles({ variant: 'secondary' })}>
            Browse events <ArrowRight className="h-4 w-4" />
          </Link>
        }
      />

      {certificates.isLoading ? (
        <div className="space-y-5">
          <Skeleton className="h-28 rounded-3xl" />
          <div className="grid gap-5 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-80 rounded-3xl" />
            ))}
          </div>
        </div>
      ) : certificates.isError ? (
        <ErrorState
          title="We could not load your certificates"
          message={errorMessage(certificates.error)}
          onRetry={() => certificates.refetch()}
        />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Award className="h-6 w-6" />}
            title="No certificates yet"
            description="Certificates are issued automatically when a coordinator marks you present at an event you registered for."
            action={
              <Link to="/student/events" className={buttonStyles({ size: 'sm' })}>
                Find an event to attend
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="relative overflow-hidden">
            <div
              className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-brand-50/80 to-transparent"
              aria-hidden
            />
            <CardContent className="relative flex flex-wrap items-center justify-between gap-5 p-6">
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-acid-200 text-ink-900 ring-1 ring-inset ring-ink-900/10">
                  <Award className="h-6 w-6" />
                </span>
                <div>
                  <p className="eyebrow">Your collection</p>
                  <p className="mt-1 text-2xl font-bold tracking-[-0.03em] text-ink-950">
                    {items.length === 1 ? 'One certificate earned' : `${items.length} certificates earned`}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-500">
                    Issued automatically when your attendance is marked present.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">
                  <CalendarDays className="h-3 w-3" /> Latest {formatDate(items[0].issueDate)}
                </Badge>
                <Badge tone="neutral">Print or save as PDF</Badge>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            {items.map((certificate) => (
              <Card
                key={certificate.certificateId}
                className="group relative overflow-hidden transition-all duration-200 animate-fade-up hover:-translate-y-0.5 hover:shadow-lift"
              >
                <div
                  className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-700 via-brand-400 to-acid-300"
                  aria-hidden
                />
                <CardContent className="space-y-5 p-6 sm:p-7">
                  <div className="flex items-start justify-between gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/10">
                      <Award className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 text-right">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-ink-400">
                        Certificate code
                      </p>
                      <p className="mt-1 break-all font-mono text-[0.6875rem] font-semibold tracking-[0.08em] text-brand-700">
                        {certificate.certificateCode}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-brand-700">
                      Certificate of participation
                    </p>
                    <h3 className="display-title mt-2 text-[1.75rem] leading-[1.1] text-ink-950">
                      {certificate.eventTitle}
                    </h3>
                    <p className="mt-1.5 text-sm text-ink-500">Hosted by {certificate.clubName}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 rounded-2xl border border-ink-100 bg-ink-50/50 px-4 py-3">
                    <div>
                      <p className="text-[0.5625rem] font-bold uppercase tracking-[0.12em] text-ink-400">
                        Event date
                      </p>
                      <p className="mt-1 text-xs font-semibold text-ink-800">
                        {formatDate(certificate.eventDate, 'd MMM yyyy')}
                      </p>
                    </div>
                    <div>
                      <p className="text-[0.5625rem] font-bold uppercase tracking-[0.12em] text-ink-400">Issued</p>
                      <p className="mt-1 text-xs font-semibold text-ink-800">
                        {formatDate(certificate.issueDate, 'd MMM yyyy')}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end justify-between gap-3 border-t border-ink-100 pt-4">
                    <div className="min-w-0">
                      <p className="text-[0.5625rem] font-bold uppercase tracking-[0.12em] text-ink-400">
                        Awarded to
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-ink-900">{studentName}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      leftIcon={<Download className="h-3.5 w-3.5" />}
                      onClick={() => downloadCertificate(certificate)}
                    >
                      Download
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <p className="flex items-center gap-2 text-xs text-ink-400">
            <Printer className="h-3.5 w-3.5" />
            Certificates open in a printable window — choose “Save as PDF” in the print dialog to keep a copy.
          </p>
        </>
      )}
    </div>
  )
}
