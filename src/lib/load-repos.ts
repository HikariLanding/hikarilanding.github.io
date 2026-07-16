import { readFileSync } from 'node:fs';
import type { Repo } from './projects';

const ORG_REPOS_URL =
  'https://api.github.com/orgs/HikariLanding/repos?per_page=100&type=public';

/**
 * 构建时的仓库数据源。
 * 设 HIKARI_REPOS_FIXTURE（JSON 文件路径）时读文件——测试与离线构建不碰网络；
 * 否则请求 GitHub API，失败即抛错让构建失败，保住上一次成功的部署。
 */
export async function loadRepos(): Promise<Repo[]> {
  const fixture = process.env.HIKARI_REPOS_FIXTURE;
  if (fixture) {
    return JSON.parse(readFileSync(fixture, 'utf8')) as Repo[];
  }

  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(ORG_REPOS_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API responded ${response.status} while listing org repos`);
  }
  return (await response.json()) as Repo[];
}
