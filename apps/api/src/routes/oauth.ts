import { Hono } from 'hono'
import type { StorageProvider } from '../lib/storage/types.js'

const oauth = new Hono()

// In-memory state storage (in production, use Redis or database)
const oauthStates = new Map<string, { provider: StorageProvider; createdAt: number }>()

// Clean up expired states (older than 10 minutes)
function cleanupExpiredStates() {
  const now = Date.now()
  for (const [state, data] of oauthStates.entries()) {
    if (now - data.createdAt > 10 * 60 * 1000) {
      oauthStates.delete(state)
    }
  }
}

// Generate random state for CSRF protection
function generateState(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

// OAuth configuration for each provider
const OAUTH_CONFIG = {
  dropbox: {
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scopes: ['files.content.read', 'sharing.read'],
  },
  'google-drive': {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  },
  sharepoint: {
    // SharePoint uses Microsoft OAuth
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Files.Read.All', 'Sites.Read.All'],
  },
}

// Get OAuth credentials from environment
function getOAuthCredentials(provider: StorageProvider) {
  switch (provider) {
    case 'dropbox':
      return {
        clientId: process.env.DROPBOX_APP_KEY || '',
        clientSecret: process.env.DROPBOX_APP_SECRET || '',
      }
    case 'google-drive':
      return {
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
      }
    case 'sharepoint':
      return {
        clientId: process.env.AZURE_CLIENT_ID || '',
        clientSecret: process.env.AZURE_CLIENT_SECRET || '',
      }
  }
}

/**
 * Get OAuth authorization URL for a provider
 */
oauth.get('/auth/:provider', (c) => {
  const provider = c.req.param('provider') as StorageProvider
  
  if (!['dropbox', 'google-drive', 'sharepoint'].includes(provider)) {
    return c.json({ error: 'Invalid provider' }, 400)
  }
  
  const config = OAUTH_CONFIG[provider]
  const credentials = getOAuthCredentials(provider)
  
  if (!credentials.clientId) {
    return c.json({ error: `OAuth not configured for ${provider}` }, 500)
  }
  
  cleanupExpiredStates()
  const state = generateState()
  oauthStates.set(state, { provider, createdAt: Date.now() })
  
  const redirectUri = `${process.env.API_URL || 'http://localhost:3009'}/api/oauth/callback/${provider}`
  
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  })
  
  // Provider-specific parameters
  if (provider === 'dropbox') {
    params.set('token_access_type', 'offline') // Request refresh token
  } else if (provider === 'google-drive') {
    params.set('scope', config.scopes.join(' '))
    params.set('access_type', 'offline')
    params.set('prompt', 'consent')
  } else if (provider === 'sharepoint') {
    params.set('scope', config.scopes.join(' ') + ' offline_access')
  }
  
  const authUrl = `${config.authUrl}?${params.toString()}`
  
  return c.json({ authUrl, state })
})

/**
 * OAuth callback handler
 */
oauth.get('/callback/:provider', async (c) => {
  const provider = c.req.param('provider') as StorageProvider
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')
  
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3010'
  
  if (error) {
    return c.redirect(`${frontendUrl}/new?oauth_error=${encodeURIComponent(error)}`)
  }
  
  if (!code || !state) {
    return c.redirect(`${frontendUrl}/new?oauth_error=missing_params`)
  }
  
  // Validate state
  const storedState = oauthStates.get(state)
  if (!storedState || storedState.provider !== provider) {
    return c.redirect(`${frontendUrl}/new?oauth_error=invalid_state`)
  }
  oauthStates.delete(state)
  
  const config = OAUTH_CONFIG[provider]
  const credentials = getOAuthCredentials(provider)
  const redirectUri = `${process.env.API_URL || 'http://localhost:3009'}/api/oauth/callback/${provider}`
  
  try {
    // Exchange code for tokens
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }),
    })
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error(`[OAUTH] Token exchange failed for ${provider}:`, errorText)
      return c.redirect(`${frontendUrl}/new?oauth_error=token_exchange_failed`)
    }
    
    const tokens = await tokenResponse.json()
    
    // Create a temporary token ID for the frontend to use
    const tokenId = generateState()
    
    // Store tokens temporarily (in production, store in database)
    // For now, we'll pass them to the frontend via URL (not ideal for production)
    // In a real implementation, you'd store tokens server-side and return a session ID
    const tokenData = encodeURIComponent(JSON.stringify({
      provider,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
    }))
    
    return c.redirect(`${frontendUrl}/new?oauth_success=${provider}&token_data=${tokenData}`)
  } catch (err) {
    console.error(`[OAUTH] Error for ${provider}:`, err)
    return c.redirect(`${frontendUrl}/new?oauth_error=server_error`)
  }
})

/**
 * List folders for a provider (used by folder browser)
 */
oauth.post('/folders/:provider', async (c) => {
  const provider = c.req.param('provider') as StorageProvider
  const body = await c.req.json()
  const { accessToken, folderId } = body
  
  if (!accessToken) {
    return c.json({ error: 'Access token required' }, 401)
  }
  
  try {
    let folders: Array<{ id: string; name: string; path?: string }> = []
    
    if (provider === 'dropbox') {
      const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: folderId || '',
          recursive: false,
        }),
      })
      
      if (!response.ok) throw new Error('Failed to list Dropbox folders')
      
      const data = await response.json()
      folders = data.entries
        .filter((entry: { '.tag': string }) => entry['.tag'] === 'folder')
        .map((entry: { id: string; name: string; path_display: string }) => ({
          id: entry.path_display, // Use path as ID for Dropbox
          name: entry.name,
          path: entry.path_display,
        }))
    } else if (provider === 'google-drive') {
      const parentId = folderId || 'root'
      const query = `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
      
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      )
      
      if (!response.ok) throw new Error('Failed to list Google Drive folders')
      
      const data = await response.json()
      folders = data.files.map((file: { id: string; name: string }) => ({
        id: file.id,
        name: file.name,
      }))
    } else if (provider === 'sharepoint') {
      // SharePoint folder listing via Microsoft Graph API
      const driveEndpoint = folderId
        ? `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`
        : 'https://graph.microsoft.com/v1.0/me/drive/root/children'
      
      const response = await fetch(
        `${driveEndpoint}?$filter=folder ne null&$select=id,name,folder`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      )
      
      if (!response.ok) throw new Error('Failed to list SharePoint folders')
      
      const data = await response.json()
      folders = data.value.map((item: { id: string; name: string }) => ({
        id: item.id,
        name: item.name,
      }))
    }
    
    return c.json({ folders })
  } catch (err) {
    console.error(`[OAUTH] Error listing folders for ${provider}:`, err)
    return c.json({ error: 'Failed to list folders' }, 500)
  }
})

/**
 * Get shareable URL for a selected folder
 */
oauth.post('/folder-url/:provider', async (c) => {
  const provider = c.req.param('provider') as StorageProvider
  const body = await c.req.json()
  const { accessToken, folderId, folderPath } = body
  
  if (!accessToken || !folderId) {
    return c.json({ error: 'Access token and folder ID required' }, 400)
  }
  
  try {
    let folderUrl = ''
    
    if (provider === 'dropbox') {
      // For Dropbox, create a shared link to the folder
      try {
        const response = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            path: folderPath || folderId,
            settings: {
              access: 'viewer',
              allow_download: true,
              audience: 'public',
            },
          }),
        })
        
        if (response.ok) {
          const data = await response.json()
          folderUrl = data.url
        } else {
          // Link might already exist, try to get it
          const getResponse = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              path: folderPath || folderId,
              direct_only: true,
            }),
          })
          
          if (getResponse.ok) {
            const getData = await getResponse.json()
            if (getData.links && getData.links.length > 0) {
              folderUrl = getData.links[0].url
            }
          }
        }
      } catch (err) {
        console.error('[OAUTH] Error creating Dropbox shared link:', err)
      }
      
      // If we couldn't create a shared link, construct a basic URL
      if (!folderUrl && folderPath) {
        folderUrl = `https://www.dropbox.com/home${folderPath}`
      }
    } else if (provider === 'google-drive') {
      // Google Drive folder URL
      folderUrl = `https://drive.google.com/drive/folders/${folderId}`
    } else if (provider === 'sharepoint') {
      // Get SharePoint/OneDrive web URL
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      )
      
      if (response.ok) {
        const data = await response.json()
        folderUrl = data.webUrl
      }
    }
    
    if (!folderUrl) {
      return c.json({ error: 'Failed to get folder URL' }, 500)
    }
    
    return c.json({ folderUrl })
  } catch (err) {
    console.error(`[OAUTH] Error getting folder URL for ${provider}:`, err)
    return c.json({ error: 'Failed to get folder URL' }, 500)
  }
})

export default oauth
