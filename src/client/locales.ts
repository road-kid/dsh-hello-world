import type { Dictionary } from './types.ts'

/**
 * Translations for the restart row, its dialog and the reload affordance.
 *
 * Kept in the client bundle rather than in `locale/*.json`: those host-side files
 * carry the plugin's `meta.title`/`meta.description` for the plugin manager, while
 * these strings are the row's own copy. The keys are flat because the runtime's
 * translator interpolates `{name}` placeholders on a flat dictionary.
 *
 * The copy follows the shipped DSH wording: a dialog title is a verb phrase and a
 * full-width question mark, its body states the consequence in one sentence and
 * offers the next step, a refusal states one fact in a clause or two without a
 * trailing period (it is read as a tooltip and as aria copy, not as prose), a
 * toast is a short sentence without a period, and the product is called DSH
 * rather than Host. Names of DSH surfaces (`DSH`, `/restart`) stay untranslated.
 *
 * Every key exists in every dictionary: the row renders one locale at a time, so
 * a key missing from the active one would surface as the raw key in the UI.
 */

/** Locale namespace; must be unique across plugins. */
export const LOCALE_NAMESPACE = 'dsh-quick-restart'

const zh: Dictionary = {
  'action.restart': '重启',
  'action.restarting': '正在重启…',
  'action.reload': '刷新页面',

  'dialog.title': '重启 DSH？',
  'dialog.description': '重启当前 DSH，自动运行新的 DSH 实例。',
  'dialog.close': '关闭',
  'dialog.cancel': '取消',
  'dialog.confirm': '重启',
  'dialog.interrupt': '会中断正在运行的会话、排队消息和后台任务。',
  'dialog.busy': '当前有 {count} 个任务正在运行。',
  'dialog.busy.one': '当前有 1 个任务正在运行。',
  'dialog.busy.none': '当前没有正在运行的任务。',
  'dialog.busy.unknown': '暂时无法确认任务状态。',
  'dialog.command.label': '重启命令',
  'dialog.command.note': 'Host 退出后运行这条命令',
  'dialog.log.label': '诊断日志',
  'dialog.log.note': '重启失败时查看该文件',

  'reason.disabled': '插件已在 profile 中停用',
  'reason.supervisor': '由 {name} 管理，请通过 {name} 重启',
  'reason.supervisor.unknown': '由进程管理器托管，请通过它重启',
  'reason.debugger': '调试器已连接到 DSH',
  'reason.busy': '有任务正在运行，重启会中断它们',
  'reason.host': '正在重启…',
  'reason.unknown': '当前无法重启',

  'toast.scheduled': '正在准备重启…',
  'toast.reconnected': 'DSH 已重启，页面已重新连接',
  'toast.timeout': '未检测到新的 DSH 响应',
  'toast.failed': '重启失败：{error}',
  'toast.unreachable': '无法连接到 DSH，重启未生效',
}

const en: Dictionary = {
  'action.restart': 'Restart',
  'action.restarting': 'Restarting…',
  'action.reload': 'Reload page',

  'dialog.title': 'Restart DSH?',
  'dialog.description': 'Restart the current DSH and run a new DSH instance automatically.',
  'dialog.close': 'Close',
  'dialog.cancel': 'Cancel',
  'dialog.confirm': 'Restart',
  'dialog.interrupt': 'Interrupts running sessions, queued messages and background jobs.',
  'dialog.busy': '{count} tasks are running.',
  'dialog.busy.one': '1 task is running.',
  'dialog.busy.none': 'No tasks are running.',
  'dialog.busy.unknown': 'Could not check running tasks.',
  'dialog.command.label': 'Restart command',
  'dialog.command.note': 'Runs once this Host exits',
  'dialog.log.label': 'Diagnostic log',
  'dialog.log.note': 'Read it when a restart fails',

  'reason.disabled': 'The plugin is disabled in the profile',
  'reason.supervisor': 'Managed by {name}; restart it through {name}',
  'reason.supervisor.unknown': 'Managed by a process supervisor; restart it there',
  'reason.debugger': 'A debugger is attached to DSH',
  'reason.busy': 'Tasks are running and a restart would interrupt them',
  'reason.host': 'Restarting…',
  'reason.unknown': 'Restart is unavailable',

  'toast.scheduled': 'Preparing to restart…',
  'toast.reconnected': 'DSH restarted; this page is connected again',
  'toast.timeout': 'No new DSH answered',
  'toast.failed': 'Restart failed: {error}',
  'toast.unreachable': 'Could not reach DSH; the restart did not take effect',
}

/** Both dictionaries, in the shape `locale.register` accepts. */
export const DICTIONARIES = { zh, en } as const
