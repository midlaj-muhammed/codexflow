import { NextResponse } from 'next/server';
import { ProviderError } from '@codexflow/providers';
import { ApiActionError, apiError } from '@/lib/api';
import { githubRepositories } from '@/lib/control-plane';
import { currentGitHubSession, githubAppInstallUrl } from '@/lib/github-auth';

export async function GET() {
  try {
    const session = await currentGitHubSession();
    if (!session) throw new Error('Sign in with GitHub before browsing repositories');
    return NextResponse.json({ repositories: await githubRepositories(session.token) });
  } catch (error) {
    if (
      error instanceof ProviderError &&
      error.message.includes('Install the GitHub App')
    ) {
      const installUrl = githubAppInstallUrl();
      return apiError(
        new ApiActionError(
          installUrl
            ? 'Install the GitHub App on the account or repository you want CodexFlow to import, then reconnect GitHub.'
            : 'Install the GitHub App on the account or repository you want CodexFlow to import. Set GITHUB_APP_SLUG or GITHUB_APP_INSTALL_URL so CodexFlow can open the install page.',
          'GITHUB_APP_NOT_INSTALLED',
          {
            action: 'INSTALL_GITHUB_APP',
            installUrl,
          },
        ),
      );
    }
    return apiError(error);
  }
}
