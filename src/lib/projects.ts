/** GitHub API 组织仓库对象中,本站关心的字段子集 */
export interface Repo {
  name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  fork: boolean;
  archived: boolean;
  private: boolean;
  pushed_at: string;
}

/** 项目区卡片消费的数据 */
export interface Project {
  name: string;
  description: string | null;
  url: string;
  language: string | null;
}

/** 官网仓库自身与组织 profile 仓库,永远不是「Hikari 项目」 */
const EXCLUDED_NAMES = new Set(['.github', 'hikarilanding.github.io']);

/**
 * 「Hikari 项目」规则的唯一实现点,边界定义见 CONTEXT.md:
 * 公开、非 fork、非 archived,排除 .github 与官网仓库,按最近推送排序。
 */
export function selectProjects(repos: Repo[]): Project[] {
  return repos
    .filter(
      (repo) =>
        !repo.private && !repo.fork && !repo.archived && !EXCLUDED_NAMES.has(repo.name),
    )
    .sort((a, b) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
    .map((repo) => ({
      name: repo.name,
      description: repo.description,
      url: repo.html_url,
      language: repo.language,
    }));
}
