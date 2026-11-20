/**
 * Software Update Checker for Server Command Center
 * Powered by Falah Tech (falah-tech.com)
 */

export const APP_VERSION = '1.1.4';
export const GITHUB_REPO = 'Abdulllah321/server-command-center';

export interface DocumentedRelease {
  summary: string;
  highlights: string[];
  features?: string[];
  fixes?: string[];
  performance?: string[];
}

export const DOCUMENTED_CHANGELOGS: Record<string, DocumentedRelease> = {
  'v1.1.4': {
    summary: 'S3 Connection Engine SigV4 fix, Base64 Python runner, and built-in terminal clipboard shortcuts.',
    highlights: [
      'Fixed S3 test connection and backup upload: replaced shell heredocs with immune Base64 Python execution.',
      'Resolved Python strftime syntax error (`invalid syntax at %Y%m%dT%H%M%SZ`) caused by shell quote nesting.',
      'Native Terminal Clipboard: Full support for Ctrl+C (smart copy/SIGINT), Ctrl+V (paste), toolbar buttons, and sleek context menu.'
    ],
    features: [
      'Base64 Pure-Python Runner: Cloud connectors now execute via Base64 decoding, completely preventing shell quote stripping.',
      'Enhanced Terminal UX: Smart Ctrl+C copies highlighted text without cancelling active remote processes.'
    ],
    fixes: [
      'Fixed S3 connection failure: eliminated `SyntaxError: invalid syntax` in AWS SigV4 signer on remote hosts without aws-cli.',
      'Fixed Dropbox large archive upload chunking script quotation over SSH.'
    ],
    performance: [
      'Instant connection validation and zero-dependency cloud backups across all Linux server distributions.'
    ]
  },
  'v1.1.3': {
    summary: '1-Click In-App Seamless Updater, Documented Release Changelogs, and Developer Diagnostics cleanup.',
    highlights: [
      '1-Click automated in-app updater: updates Server Command Center directly in-place without manual uninstall/reinstall.',
      'Comprehensive documented release changelogs integrated directly into the Update Center.',
      'Cleaned up developer build pipeline cards from user view for a refined production experience.',
      'Verified universal S3-compatible path-style storage (Cloudflare R2, MinIO) and 1 GB+ SSH streaming upload engine.'
    ],
    features: [
      'Seamless In-Place Upgrade Engine: Downloads setup installer to temp directory with real-time progress and launches installer in background before restarting.',
      'Documented Changelogs UI: Visual cards categorizing Highlights, New Features, Bug Fixes, and Performance metrics for every version.',
      'Refined Settings Experience: Streamlined user interface focusing on update management and version switching.'
    ],
    fixes: [
      'Removed developer pipeline cards from user view in the Update Center as requested.',
      'Preserves all user configuration, encrypted credentials, and server profiles across updates without uninstall.'
    ],
    performance: [
      'Fast background download with progress streaming and lightweight asset caching.'
    ]
  },
  'v1.1.2': {
    summary: 'High-speed chunked 1 GB+ file upload over SSH, universal S3 path-style support for Cloudflare R2 / MinIO, and 1-Click in-app updater.',
    highlights: [
      'Chunked streaming file upload in File Manager (1 MB slices, zero memory overflow, 1 GB+ supported).',
      'Universal S3-compatible path-style storage & ListObjectsV2 probing for Cloudflare R2, MinIO, Wasabi.',
      '1-Click automated in-app update installer: upgrade instantly without uninstalling or manual downloads.',
      'Cloud backup upload parameter resolution fix for saved target profiles.'
    ],
    features: [
      'File Manager Chunked Streaming: 1 MB binary chunks streamed into SSH channel STDIN with atomic rename.',
      'Real-time Transfer Progress: Live percentage, upload speed in MB/s, ETA, and cancellation button.',
      '1-Click Automated In-App Updater: Downloads and applies upgrades in-place, restarting into the new version.',
      'Universal S3 Path-Style: Seamless support for custom endpoints (Cloudflare R2, MinIO, Wasabi, Ceph).'
    ],
    fixes: [
      'Resolved invalid args `provider` error when uploading existing backups to cloud storage.',
      'Fixed S3 DNS getaddrinfo error by avoiding virtual-host prefixing on custom endpoints.',
      'Replaced GetBucketLocation with universally supported ListObjectsV2 probe.',
      'Fixed Dropbox large file upload by implementing upload session chunking for files > 140 MB.',
      'Eliminated ARG_MAX command line overflows by streaming binary data directly over SSH STDIN.'
    ],
    performance: [
      'Zero server RAM ballooning during multi-gigabyte uploads (streams directly from STDIN to disk).',
      'Extended cloud storage socket timeouts to 1800s to support large multi-gigabyte archive backups.'
    ]
  },
  'v1.1.1': {
    summary: 'Hotfix release for S3 backup credential validation and update tracking center.',
    highlights: [
      'Fixed S3 credential field mapping (`access_key` vs `access_key_id`).',
      'Integrated dedicated Software Updates & Release Tracker in Settings.'
    ],
    features: [
      'Added Update Tracker with GitHub Releases synchronization and asset inspection.',
      'Added automated release publication pipeline with cross-platform artifact builds.'
    ],
    fixes: [
      'Fixed S3 credential validation error where Access Key ID and Secret Access Key were flagged missing.'
    ]
  },
  'v1.1.0': {
    summary: 'Major release introducing Remote File Manager, Nginx Site Configurator, Cloud Backups, and Security Center.',
    highlights: [
      'Full-featured Remote File Manager with Zero-RAM remote browser and Monaco code editor.',
      'Nginx Site Manager with syntax validation, SSL certbot renewal, and live reload.',
      'Automated backup scheduler with Cron synchronization and offsite S3 / Dropbox uploading.',
      'UFW Firewall & Port Tunnel management.'
    ],
    features: [
      'Remote File Explorer with file edit, permissions (chmod), rename, deletion, and download.',
      'Nginx reverse proxy site manager and SSL certificate renewal.',
      'Automated backup cron synchronization and cloud storage target profiles.',
      'SSH port forwarding and tunneling manager.'
    ]
  },
  'v1.0.0': {
    summary: 'Initial production release of Server Command Center.',
    highlights: [
      'Multi-server inventory management with hardware health analytics (CPU, RAM, Disk).',
      'Direct PM2 process management with live log streaming.',
      'Encrypted local vault with optional Windows Hello biometric authentication.',
      'Zero-downtime rebuild engine for fullstack applications.'
    ]
  }
};

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  htmlUrl: string;
  exeInstallerUrl?: string;
  exePortableUrl?: string;
  apkUrl?: string;
}

/**
 * Compare two semver strings (e.g., "1.0.1" vs "1.0.0" or "v1.0.1" vs "v1.0.0")
 */
export function isNewerVersion(remoteTag: string, localVersion: string): boolean {
  const cleanRemote = remoteTag.replace(/^v/i, '').trim();
  const cleanLocal = localVersion.replace(/^v/i, '').trim();

  const remoteParts = cleanRemote.split('.').map(p => parseInt(p, 10) || 0);
  const localParts = cleanLocal.split('.').map(p => parseInt(p, 10) || 0);

  const length = Math.max(remoteParts.length, localParts.length);
  for (let i = 0; i < length; i++) {
    const r = remoteParts[i] || 0;
    const l = localParts[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

/**
 * Check GitHub Releases for the latest application version
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // No releases published yet on GitHub
        return {
          hasUpdate: false,
          currentVersion: APP_VERSION,
          latestVersion: APP_VERSION,
          releaseName: 'Initial Release',
          releaseNotes: 'No remote releases found. You are running the baseline build.',
          publishedAt: new Date().toISOString(),
          htmlUrl: `https://github.com/${GITHUB_REPO}/releases`,
        };
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const latestTag: string = data.tag_name || APP_VERSION;
    const hasUpdate = isNewerVersion(latestTag, APP_VERSION);

    let exeInstallerUrl: string | undefined;
    let exePortableUrl: string | undefined;
    let apkUrl: string | undefined;

    if (Array.isArray(data.assets)) {
      for (const asset of data.assets as ReleaseAsset[]) {
        const nameLower = asset.name.toLowerCase();
        if (nameLower.endsWith('-setup.exe') || (nameLower.includes('setup') && nameLower.endsWith('.exe'))) {
          exeInstallerUrl = asset.browser_download_url;
        } else if (nameLower.endsWith('.exe') && !exeInstallerUrl) {
          exePortableUrl = asset.browser_download_url;
        } else if (nameLower.endsWith('.apk')) {
          apkUrl = asset.browser_download_url;
        }
      }
    }

    return {
      hasUpdate,
      currentVersion: APP_VERSION,
      latestVersion: latestTag.replace(/^v/i, ''),
      releaseName: data.name || latestTag,
      releaseNotes: data.body || 'No release notes provided.',
      publishedAt: data.published_at || new Date().toISOString(),
      htmlUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
      exeInstallerUrl,
      exePortableUrl,
      apkUrl,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to check for updates. Please verify your internet connection.';
    throw new Error(msg, { cause: err });
  }
}

export interface ReleaseAssetInfo {
  name: string;
  downloadUrl: string;
  size: number;
  downloadCount: number;
  type: 'installer' | 'portable' | 'apk' | 'checksums' | 'other';
}

export interface ReleaseHistoryItem {
  id: number;
  tagName: string;
  cleanVersion: string;
  name: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
  isPrerelease: boolean;
  isCurrent: boolean;
  isNewer: boolean;
  assets: ReleaseAssetInfo[];
}

/**
 * Fetch all recent releases from GitHub for detailed changelog and update tracking
 */
export async function fetchReleaseHistory(): Promise<ReleaseHistoryItem[]> {
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    return data.map((item: any) => {
      const tagName: string = item.tag_name || '';
      const cleanVersion = tagName.replace(/^v/i, '');
      const isCurrent = cleanVersion === APP_VERSION || tagName === `v${APP_VERSION}`;
      const isNewer = isNewerVersion(tagName, APP_VERSION);

      const assets: ReleaseAssetInfo[] = Array.isArray(item.assets)
        ? item.assets.map((a: any) => {
            const nameLower = (a.name || '').toLowerCase();
            let type: ReleaseAssetInfo['type'] = 'other';
            if (nameLower.endsWith('-setup.exe') || (nameLower.includes('setup') && nameLower.endsWith('.exe'))) {
              type = 'installer';
            } else if (nameLower.endsWith('.exe')) {
              type = 'portable';
            } else if (nameLower.endsWith('.apk')) {
              type = 'apk';
            } else if (nameLower.includes('checksum') || nameLower.endsWith('.sha256') || nameLower.endsWith('.txt')) {
              type = 'checksums';
            }

            return {
              name: a.name || 'unnamed',
              downloadUrl: a.browser_download_url || '',
              size: a.size || 0,
              downloadCount: a.download_count || 0,
              type,
            };
          })
        : [];

      return {
        id: item.id,
        tagName,
        cleanVersion,
        name: item.name || tagName,
        body: item.body || 'No release notes provided.',
        publishedAt: item.published_at || new Date().toISOString(),
        htmlUrl: item.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/${tagName}`,
        isPrerelease: Boolean(item.prerelease),
        isCurrent,
        isNewer,
        assets,
      };
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch release history.';
    throw new Error(msg, { cause: err });
  }
}
