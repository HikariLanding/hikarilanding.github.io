export type Theme = 'light' | 'dark';

/**
 * 主题决策的唯一实现点:localStorage 的显式选择覆盖系统偏好,
 * 未选择或值损坏时跟随系统。
 * （head 里的防闪烁内联脚本无法 import,内联复刻了 stored 分支——改动需同步。）
 */
export function resolveTheme(stored: string | null, systemPrefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  return systemPrefersDark ? 'dark' : 'light';
}
