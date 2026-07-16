import { describe, expect, it } from 'vitest';
import { selectProjects, type Repo } from '../src/lib/projects';

/** 便捷构造：默认是一个合格的「Hikari 项目」 */
function repo(overrides: Partial<Repo> & { name: string }): Repo {
  return {
    description: 'a small tool',
    html_url: `https://github.com/HikariLanding/${overrides.name}`,
    language: 'TypeScript',
    fork: false,
    archived: false,
    private: false,
    pushed_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('selectProjects — 「Hikari 项目」规则 (CONTEXT.md)', () => {
  it('keeps public, non-fork, non-archived repos', () => {
    const picked = selectProjects([repo({ name: 'lumen' })]);
    expect(picked).toHaveLength(1);
    expect(picked[0]).toEqual({
      name: 'lumen',
      description: 'a small tool',
      url: 'https://github.com/HikariLanding/lumen',
      language: 'TypeScript',
    });
  });

  it('excludes forks', () => {
    expect(selectProjects([repo({ name: 'forked', fork: true })])).toEqual([]);
  });

  it('excludes archived repos', () => {
    expect(selectProjects([repo({ name: 'old', archived: true })])).toEqual([]);
  });

  it('excludes private repos', () => {
    expect(selectProjects([repo({ name: 'secret', private: true })])).toEqual([]);
  });

  it('excludes .github and the site repo itself', () => {
    expect(
      selectProjects([repo({ name: '.github' }), repo({ name: 'hikarilanding.github.io' })]),
    ).toEqual([]);
  });

  it('sorts by most recent push first', () => {
    const picked = selectProjects([
      repo({ name: 'older', pushed_at: '2026-01-01T00:00:00Z' }),
      repo({ name: 'newest', pushed_at: '2026-07-01T00:00:00Z' }),
      repo({ name: 'middle', pushed_at: '2026-03-01T00:00:00Z' }),
    ]);
    expect(picked.map((p) => p.name)).toEqual(['newest', 'middle', 'older']);
  });

  it('tolerates missing description and language', () => {
    const picked = selectProjects([repo({ name: 'bare', description: null, language: null })]);
    expect(picked[0]).toMatchObject({ name: 'bare', description: null, language: null });
  });

  it('sorts never-pushed repos (pushed_at: null) last, deterministically', () => {
    const picked = selectProjects([
      repo({ name: 'unborn', pushed_at: null }),
      repo({ name: 'active', pushed_at: '2026-07-01T00:00:00Z' }),
    ]);
    expect(picked.map((p) => p.name)).toEqual(['active', 'unborn']);
  });

  it('returns [] for an empty org', () => {
    expect(selectProjects([])).toEqual([]);
  });
});
