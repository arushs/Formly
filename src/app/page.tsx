import Link from 'next/link'
import { prisma } from '@/lib/prisma'

const statusColors: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-800',
  INTAKE_DONE: 'bg-blue-100 text-blue-800',
  COLLECTING: 'bg-yellow-100 text-yellow-800',
  READY: 'bg-green-100 text-green-800',
}

export default async function HomePage() {
  const engagements = await prisma.engagement.findMany({
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Tax Intake Agent</h1>
            <p className="text-gray-600 mt-1">Demo MVP - Document Collection Dashboard</p>
          </div>
          <Link
            href="/engagements/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            New Engagement
          </Link>
        </div>

        {engagements.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border">
            <p className="text-gray-500 mb-4">No engagements yet</p>
            <Link
              href="/engagements/new"
              className="text-blue-600 hover:underline"
            >
              Create your first engagement
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {engagements.map((engagement) => {
              const reconciliation = engagement.reconciliation as { completionPercentage?: number } | null
              const completion = reconciliation?.completionPercentage ?? 0

              return (
                <Link
                  key={engagement.id}
                  href={`/engagements/${engagement.id}`}
                  className="block bg-white p-6 rounded-lg border hover:shadow-md transition-shadow"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">
                        {engagement.clientName}
                      </h2>
                      <p className="text-gray-600">{engagement.clientEmail}</p>
                      <p className="text-sm text-gray-500 mt-1">
                        Tax Year: {engagement.taxYear}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${statusColors[engagement.status] || statusColors.PENDING}`}>
                        {engagement.status.replace('_', ' ')}
                      </span>
                      {completion > 0 && (
                        <p className="text-sm text-gray-500 mt-2">
                          {completion}% complete
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
