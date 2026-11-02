/**
 * Software Update Checker for Server Command Center
 * Powered by Falah Tech (falah-tech.com)
 */

export const APP_VERSION = '1.0.0';
export const GITHUB_REPO = 'Abdulllah321/server-command-center';

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
