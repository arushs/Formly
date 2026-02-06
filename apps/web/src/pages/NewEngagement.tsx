import { useState, useMemo, useEffect } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { createEngagement } from '../api/client'

type StorageProvider = 'sharepoint' | 'google-drive' | 'dropbox'

interface OAuthTokenData {
  provider: StorageProvider
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

interface Folder {
  id: string
  name: string
  path?: string
}

/**
 * Detect storage provider from URL (mirrors backend detectProvider)
 */
function detectProvider(url: string): StorageProvider | null {
  if (url.includes('sharepoint.com') || url.includes('onedrive.com')) {
    return 'sharepoint'
  }
  if (url.includes('drive.google.com')) {
    return 'google-drive'
  }
  if (url.includes('dropbox.com')) {
    return 'dropbox'
  }
  return null
}

const PROVIDER_LABELS: Record<StorageProvider, string> = {
  'sharepoint': 'SharePoint/OneDrive',
  'google-drive': 'Google Drive',
  'dropbox': 'Dropbox',
}

const PROVIDER_CONFIG: Record<StorageProvider, {
  placeholder: string
  helpText: string
  urlPattern: RegExp
}> = {
  'dropbox': {
    placeholder: 'https://www.dropbox.com/scl/fo/abc123...',
    helpText: 'Paste the shared folder link from Dropbox. Right-click folder → Share → Copy link.',
    urlPattern: /dropbox\.com/,
  },
  'google-drive': {
    placeholder: 'https://drive.google.com/drive/folders/abc123...',
    helpText: 'Paste the folder link from Google Drive. Right-click folder → Get link → Copy link.',
    urlPattern: /drive\.google\.com/,
  },
  'sharepoint': {
    placeholder: 'https://company.sharepoint.com/sites/...',
    helpText: 'Paste the SharePoint or OneDrive folder URL. Open the folder and copy the URL from your browser.',
    urlPattern: /(sharepoint\.com|onedrive\.com)/,
  },
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3009'

export default function NewEngagement() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<StorageProvider | null>(null)
  const [storageFolderUrl, setStorageFolderUrl] = useState('')
  const [inputMode, setInputMode] = useState<'url' | 'oauth'>('url')
  
  // OAuth state
  const [oauthTokens, setOauthTokens] = useState<OAuthTokenData | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderPath, setFolderPath] = useState<Folder[]>([]) // Breadcrumb path
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null)

  const detectedProvider = useMemo(() => detectProvider(storageFolderUrl), [storageFolderUrl])
  
  // Validation: if provider is selected, URL must match that provider
  const urlMismatch = useMemo(() => {
    if (!selectedProvider || !storageFolderUrl || storageFolderUrl.length < 10) return false
    const detected = detectProvider(storageFolderUrl)
    return detected !== null && detected !== selectedProvider
  }, [selectedProvider, storageFolderUrl])

  const currentConfig = selectedProvider ? PROVIDER_CONFIG[selectedProvider] : null

  // Handle OAuth callback on mount
  useEffect(() => {
    const oauthSuccess = searchParams.get('oauth_success')
    const oauthError = searchParams.get('oauth_error')
    const tokenData = searchParams.get('token_data')
    
    if (oauthError) {
      setError(`OAuth error: ${oauthError.replace(/_/g, ' ')}`)
      // Clear URL params
      setSearchParams({})
    } else if (oauthSuccess && tokenData) {
      try {
        const tokens = JSON.parse(decodeURIComponent(tokenData)) as OAuthTokenData
        setOauthTokens(tokens)
        setSelectedProvider(tokens.provider)
        setInputMode('oauth')
        // Clear URL params
        setSearchParams({})
        // Load root folders
        loadFolders(tokens)
      } catch (err) {
        console.error('Failed to parse OAuth tokens:', err)
        setError('Failed to complete OAuth connection')
        setSearchParams({})
      }
    }
  }, [searchParams, setSearchParams])

  async function loadFolders(tokens: OAuthTokenData, folderId?: string) {
    setLoadingFolders(true)
    try {
      const response = await fetch(`${API_URL}/api/oauth/folders/${tokens.provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: tokens.accessToken,
          folderId,
        }),
      })
      
      if (!response.ok) throw new Error('Failed to load folders')
      
      const data = await response.json()
      setFolders(data.folders)
    } catch (err) {
      console.error('Failed to load folders:', err)
      setError('Failed to load folders. Please try again.')
    } finally {
      setLoadingFolders(false)
    }
  }

  async function handleOAuthConnect(provider: StorageProvider) {
    setIsConnecting(true)
    setError(null)
    
    try {
      const response = await fetch(`${API_URL}/api/oauth/auth/${provider}`)
      const data = await response.json()
      
      if (data.authUrl) {
        // Redirect to OAuth provider
        window.location.href = data.authUrl
      } else {
        setError(data.error || 'Failed to start OAuth flow')
        setIsConnecting(false)
      }
    } catch (err) {
      console.error('OAuth error:', err)
      setError('Failed to connect. Please try again.')
      setIsConnecting(false)
    }
  }

  async function handleFolderSelect(folder: Folder) {
    // Navigate into folder
    setFolderPath([...folderPath, folder])
    setSelectedFolder(null)
    if (oauthTokens) {
      await loadFolders(oauthTokens, folder.id)
    }
  }

  function handleFolderClick(folder: Folder) {
    setSelectedFolder(folder)
  }

  async function handleBreadcrumbClick(index: number) {
    // Navigate to a folder in the breadcrumb
    const newPath = folderPath.slice(0, index)
    setFolderPath(newPath)
    setSelectedFolder(null)
    
    if (oauthTokens) {
      const folderId = index === 0 ? undefined : newPath[newPath.length - 1]?.id
      await loadFolders(oauthTokens, folderId)
    }
  }

  async function handleUseSelectedFolder() {
    if (!selectedFolder || !oauthTokens) return
    
    setLoadingFolders(true)
    try {
      const response = await fetch(`${API_URL}/api/oauth/folder-url/${oauthTokens.provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: oauthTokens.accessToken,
          folderId: selectedFolder.id,
          folderPath: selectedFolder.path,
        }),
      })
      
      if (!response.ok) throw new Error('Failed to get folder URL')
      
      const data = await response.json()
      setStorageFolderUrl(data.folderUrl)
      setInputMode('url') // Switch to URL mode to show the resolved URL
    } catch (err) {
      console.error('Failed to get folder URL:', err)
      setError('Failed to select folder. Please try again.')
    } finally {
      setLoadingFolders(false)
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    
    // Validate URL matches selected provider
    if (urlMismatch) {
      setError(`URL doesn't match selected provider. Expected ${PROVIDER_LABELS[selectedProvider!]} URL.`)
      return
    }
    
    setIsSubmitting(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const data = {
      clientName: formData.get('clientName') as string,
      clientEmail: formData.get('clientEmail') as string,
      storageFolderUrl: formData.get('storageFolderUrl') as string,
    }

    try {
      const engagement = await createEngagement(data)
      navigate(`/engagements/${engagement.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleProviderChange(provider: StorageProvider) {
    setSelectedProvider(provider)
    // Clear URL if it doesn't match the newly selected provider
    if (storageFolderUrl && detectProvider(storageFolderUrl) !== provider) {
      setStorageFolderUrl('')
    }
    // Reset OAuth state when switching providers
    if (oauthTokens?.provider !== provider) {
      setOauthTokens(null)
      setFolders([])
      setFolderPath([])
      setSelectedFolder(null)
    }
  }

  function handleDisconnect() {
    setOauthTokens(null)
    setFolders([])
    setFolderPath([])
    setSelectedFolder(null)
    setInputMode('url')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto p-6">
        <div className="mb-6">
          <Link to="/" className="text-blue-600 hover:underline">
            &larr; Back to Dashboard
          </Link>
        </div>

        <div className="bg-white p-8 rounded-lg border">
          <h1 className="text-2xl font-bold mb-6">Start New Collection</h1>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="clientName" className="block text-sm font-medium text-gray-700 mb-2">
                Client Name
              </label>
              <input
                type="text"
                id="clientName"
                name="clientName"
                required
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="John Smith"
              />
            </div>

            <div>
              <label htmlFor="clientEmail" className="block text-sm font-medium text-gray-700 mb-2">
                Client Email
              </label>
              <input
                type="email"
                id="clientEmail"
                name="clientEmail"
                required
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="john@example.com"
              />
            </div>

            {/* Provider Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Storage Provider
              </label>
              <div className="grid grid-cols-3 gap-3">
                {(Object.keys(PROVIDER_CONFIG) as StorageProvider[]).map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    onClick={() => handleProviderChange(provider)}
                    className={`p-3 border rounded-lg text-sm font-medium transition-colors ${
                      selectedProvider === provider
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 hover:border-gray-400 text-gray-700'
                    }`}
                  >
                    {PROVIDER_LABELS[provider]}
                  </button>
                ))}
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Select where your client will upload documents
              </p>
            </div>

            {/* Input Mode Tabs (shown when provider is selected) */}
            {selectedProvider && (
              <div>
                <div className="flex border-b mb-4">
                  <button
                    type="button"
                    onClick={() => setInputMode('url')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      inputMode === 'url'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Paste URL
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('oauth')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      inputMode === 'oauth'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Connect Account
                  </button>
                </div>

                {inputMode === 'url' ? (
                  /* URL Input Mode */
                  <div>
                    <label htmlFor="storageFolderUrl" className="block text-sm font-medium text-gray-700 mb-2">
                      Storage Folder URL
                    </label>
                    <input
                      type="url"
                      id="storageFolderUrl"
                      name="storageFolderUrl"
                      required
                      value={storageFolderUrl}
                      onChange={(e) => setStorageFolderUrl(e.target.value)}
                      className={`w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        urlMismatch ? 'border-red-300 bg-red-50' : ''
                      }`}
                      placeholder={currentConfig?.placeholder || 'Select a provider above, or paste any supported URL'}
                    />
                    <div className="mt-2 space-y-1">
                      {currentConfig && (
                        <p className="text-sm text-gray-600">
                          {currentConfig.helpText}
                        </p>
                      )}
                      
                      {urlMismatch ? (
                        <p className="text-sm text-red-600 flex items-center gap-1">
                          <span>✗</span>
                          <span>URL is for {PROVIDER_LABELS[detectedProvider!]}, but you selected {PROVIDER_LABELS[selectedProvider!]}</span>
                        </p>
                      ) : detectedProvider ? (
                        <p className="text-sm text-green-600 flex items-center gap-1">
                          <span>✓</span>
                          <span>Detected: <strong>{PROVIDER_LABELS[detectedProvider]}</strong></span>
                        </p>
                      ) : storageFolderUrl.length > 0 ? (
                        <p className="text-sm text-amber-600">
                          Unable to detect provider. Please use a valid URL from a supported service.
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  /* OAuth Mode */
                  <div>
                    {!oauthTokens ? (
                      /* Connect Button */
                      <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed">
                        <p className="text-gray-600 mb-4">
                          Connect your {PROVIDER_LABELS[selectedProvider]} account to browse and select a folder
                        </p>
                        <button
                          type="button"
                          onClick={() => handleOAuthConnect(selectedProvider)}
                          disabled={isConnecting}
                          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                          {isConnecting ? (
                            <>
                              <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Connecting...
                            </>
                          ) : (
                            <>Connect {PROVIDER_LABELS[selectedProvider]}</>
                          )}
                        </button>
                      </div>
                    ) : (
                      /* Folder Browser */
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm text-green-600 flex items-center gap-1">
                            <span>✓</span>
                            <span>Connected to {PROVIDER_LABELS[oauthTokens.provider]}</span>
                          </p>
                          <button
                            type="button"
                            onClick={handleDisconnect}
                            className="text-sm text-gray-500 hover:text-gray-700"
                          >
                            Disconnect
                          </button>
                        </div>
                        
                        {/* Breadcrumb Navigation */}
                        <div className="flex items-center gap-1 text-sm mb-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleBreadcrumbClick(0)}
                            className="text-blue-600 hover:underline"
                          >
                            Root
                          </button>
                          {folderPath.map((folder, index) => (
                            <span key={folder.id} className="flex items-center gap-1">
                              <span className="text-gray-400">/</span>
                              <button
                                type="button"
                                onClick={() => handleBreadcrumbClick(index + 1)}
                                className="text-blue-600 hover:underline"
                              >
                                {folder.name}
                              </button>
                            </span>
                          ))}
                        </div>
                        
                        {/* Folder List */}
                        <div className="border rounded-lg max-h-60 overflow-y-auto">
                          {loadingFolders ? (
                            <div className="p-4 text-center text-gray-500">
                              Loading folders...
                            </div>
                          ) : folders.length === 0 ? (
                            <div className="p-4 text-center text-gray-500">
                              No subfolders found. Select this folder or navigate back.
                            </div>
                          ) : (
                            <ul className="divide-y">
                              {folders.map((folder) => (
                                <li
                                  key={folder.id}
                                  className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
                                    selectedFolder?.id === folder.id
                                      ? 'bg-blue-50'
                                      : 'hover:bg-gray-50'
                                  }`}
                                  onClick={() => handleFolderClick(folder)}
                                  onDoubleClick={() => handleFolderSelect(folder)}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-yellow-500">📁</span>
                                    <span className="text-gray-900">{folder.name}</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleFolderSelect(folder)
                                    }}
                                    className="text-xs text-blue-600 hover:underline"
                                  >
                                    Open →
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        
                        {/* Select Folder Button */}
                        <div className="mt-3 flex items-center justify-between">
                          <p className="text-sm text-gray-500">
                            {selectedFolder 
                              ? `Selected: ${selectedFolder.name}` 
                              : folderPath.length > 0 
                                ? `Current: ${folderPath[folderPath.length - 1].name}`
                                : 'Select a folder or use current location'
                            }
                          </p>
                          <button
                            type="button"
                            onClick={handleUseSelectedFolder}
                            disabled={!selectedFolder && folderPath.length === 0}
                            className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            Use {selectedFolder ? 'Selected' : 'Current'} Folder
                          </button>
                        </div>
                        
                        {/* Hidden input for form submission */}
                        <input
                          type="hidden"
                          name="storageFolderUrl"
                          value={storageFolderUrl}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Show URL input when no provider is selected */}
            {!selectedProvider && (
              <div>
                <label htmlFor="storageFolderUrl" className="block text-sm font-medium text-gray-700 mb-2">
                  Storage Folder URL
                </label>
                <input
                  type="url"
                  id="storageFolderUrl"
                  name="storageFolderUrl"
                  required
                  value={storageFolderUrl}
                  onChange={(e) => setStorageFolderUrl(e.target.value)}
                  className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Select a provider above, or paste any supported URL"
                />
                <div className="mt-2 space-y-1">
                  {detectedProvider ? (
                    <p className="text-sm text-green-600 flex items-center gap-1">
                      <span>✓</span>
                      <span>Detected: <strong>{PROVIDER_LABELS[detectedProvider]}</strong></span>
                    </p>
                  ) : storageFolderUrl.length > 0 ? (
                    <p className="text-sm text-amber-600">
                      Unable to detect provider. Please use a valid URL from a supported service.
                    </p>
                  ) : null}
                  <p className="text-sm text-gray-500">
                    Supported: Dropbox, Google Drive, SharePoint/OneDrive
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-50 text-red-700 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || urlMismatch || (inputMode === 'oauth' && !storageFolderUrl)}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create Engagement'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
