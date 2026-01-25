'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function GenerateBriefButton({ engagementId }: { engagementId: string }) {
  const router = useRouter()
  const [isGenerating, setIsGenerating] = useState(false)

  async function handleGenerate() {
    setIsGenerating(true)
    try {
      const response = await fetch(`/api/engagements/${engagementId}/brief`, {
        method: 'POST',
      })
      if (response.ok) {
        router.refresh()
      }
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <button
      onClick={handleGenerate}
      disabled={isGenerating}
      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {isGenerating ? 'Generating...' : 'Generate Brief'}
    </button>
  )
}
