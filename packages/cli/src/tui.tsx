import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'
import Fuse from 'fuse.js'
import type { Config, PendingLog, ActiveTimer } from '@dhyantd/open-zoho-tui-core'
import type { ModuleField, Portal, Project, Task, TaskList, TaskStatus } from '@dhyantd/open-zoho-tui-zoho-client'
import { ZohoError } from '@dhyantd/open-zoho-tui-zoho-client'
import type { DeviceLogin, OztServices } from './services.js'

type Screen = 'tasks' | 'time' | 'settings'
type Billing = 'Billable' | 'Non Billable'

interface Choice {
  id: string
  label: string
}

interface FormField {
  name: string
  label: string
  value: string
  type: 'text' | 'multiline' | 'choice' | 'submit'
  required?: boolean
  options?: Choice[]
}

interface FormState {
  kind: 'create' | 'edit' | 'start' | 'stop' | 'add' | 'addGeneral' | 'config'
  title: string
  fields: FormField[]
  active: number
  original: string
  taskRef?: string
  configKey?: keyof Config
}

type SelectorPurpose = 'portal' | 'project' | 'move' | 'defaultTasklist' | 'manualTask'

interface SelectorState {
  kind: 'selector'
  purpose: SelectorPurpose
  title: string
  items: Choice[]
  selected: number
  query: string
}

type ConfirmAction = 'cancelTimer' | 'logout' | 'discardForm'

type Modal =
  | { kind: 'help' }
  | SelectorState
  | { kind: 'form'; form: FormState }
  | { kind: 'confirm'; action: ConfirmAction; message: string; returnForm?: FormState }
  | { kind: 'login'; login: DeviceLogin; startedAt: number }

const builtInTaskFields = new Set([
  'id', 'key', 'name', 'description', 'status', 'tasklist', 'project', 'priority', 'due_date', 'assignee',
])
const generalTimeChoiceId = '__ozt_general_time_log__'

export function filterTasks(tasks: Task[], query: string): Task[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return tasks
  const exact = tasks.filter((task) => task.id.toLowerCase() === normalized || task.key?.toLowerCase() === normalized)
  if (exact.length > 0) return exact
  const fuse = new Fuse(tasks, { keys: ['name', 'key', 'status.name', 'tasklist.name'], threshold: 0.35 })
  return fuse.search(query).map(({ item }) => item)
}

export function manualTimeChoices(items: Choice[], query: string): Choice[] {
  const normalized = query.trim().toLowerCase()
  let matches = items
  if (normalized) {
    const exact = items.filter(({ id, label }) => id.toLowerCase() === normalized || label.toLowerCase() === normalized)
    matches = exact.length > 0
      ? exact
      : new Fuse(items, { keys: ['label'], threshold: 0.35 }).search(query).map(({ item }) => item)
  }
  const activity = query.trim()
  return [...matches, {
    id: generalTimeChoiceId,
    label: activity
      ? `General time log · ${activity}`
      : 'General time log · meeting, admin, or other activity',
  }]
}

function selectorChoices(selector: SelectorState): Choice[] {
  if (selector.purpose === 'manualTask') return manualTimeChoices(selector.items, selector.query)
  const normalized = selector.query.toLowerCase()
  return selector.items.filter(({ label }) => label.toLowerCase().includes(normalized))
}

export function formatElapsed(startedAt: string, now = Date.now()): string {
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1_000))
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

export function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function newestTimeLogs(logs: PendingLog[]): PendingLog[] {
  return [...logs].sort((left, right) => (
    right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt)
  ))
}

export function taskForTimeLog(log: PendingLog, tasks: Task[]): Task | undefined {
  if (!log.taskRef) return undefined
  const reference = log.taskRef.toLowerCase()
  return tasks.find(({ id, key }) => id.toLowerCase() === reference || key?.toLowerCase() === reference)
}

export function timeLogDetailRows(log: PendingLog, task?: Task): [string, string][] {
  const targetRows: [string, string][] = log.generalName
    ? [['Target type', 'General activity'], ['Activity', log.generalName]]
    : [
        ['Target type', 'Task'],
        ['Task name', task?.name ?? 'Name unavailable'],
        ['Task ID', log.taskRef ?? 'Not set'],
        ...(task?.key ? [['Task key', task.key] as [string, string]] : []),
      ]
  return [
    ...targetRows,
    ['State', log.state],
    ['Date', log.date],
    ['Duration', `${formatMinutes(log.minutes)} (${log.minutes} minutes)`],
    ['Billing', log.billing],
    ['Notes', log.notes || 'No notes'],
    ['Project ID', log.projectId],
    ['Created', log.createdAt],
    ['Zoho ID', log.zohoId ?? 'Not submitted'],
    ['Local ID', log.id],
    ['Last error', log.lastError ?? 'None'],
  ]
}

export function isSaveShortcut(input: string, key: { ctrl: boolean; shift: boolean; meta: boolean }): boolean {
  return input.toLowerCase() === 's' && ((key.ctrl && key.shift) || key.meta)
}

function clamp(value: number, length: number): number {
  return Math.max(0, Math.min(Math.max(0, length - 1), value))
}

function valueOf(form: FormState, name: string): string {
  return form.fields.find((field) => field.name === name)?.value ?? ''
}

function choiceLabel(field: FormField): string {
  return (field.options?.find(({ id }) => id === field.value)?.label ?? field.value) || '(none)'
}

function today(timezone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone,
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function errorMessage(error: unknown): string {
  if (error instanceof ZohoError) {
    if (error.status === 401) return 'Authentication expired. Sign in again from Settings.'
    if (error.status === 403) return `Zoho denied this action: ${error.message}`
    if (error.status === 429) return `Zoho rate limit reached${error.retryAfterSeconds ? `; retry in ${error.retryAfterSeconds}s` : ''}.`
  }
  return error instanceof Error ? error.message : String(error)
}

function portalName(portal: Portal): string {
  return portal.portal_name ?? portal.org_name ?? portal.id
}

export function fieldOptions(field: ModuleField): Choice[] {
  const usesDisplayValue = field.type.toLowerCase() === 'picklist'
  return (field.pick_list_values ?? field.options ?? [])
    .filter(({ id, value }) => id && value)
    .map(({ id, value }) => ({ id: usesDisplayValue ? value : id, label: value }))
}

function customFields(fields: ModuleField[]): ModuleField[] {
  return fields.filter((field) => field.is_custom_field === true && !builtInTaskFields.has(field.api_name))
}

function TextField({ field, active }: { field: FormField; active: boolean }) {
  if (field.type === 'submit') {
    return <Box marginTop={1}>
      <Text {...(active ? { color: 'green' as const } : {})} inverse={active} bold>{active ? '› ' : '  '}[ Save ]{active ? '  Press Enter' : ''}</Text>
    </Box>
  }
  const displayed = field.type === 'choice' ? choiceLabel(field) : field.value.replaceAll('\n', ' ↵ ')
  return <Box>
    <Text {...(active ? { color: 'cyan' as const } : {})}>{active ? '› ' : '  '}{field.label}{field.required ? ' *' : ''}: </Text>
    <Text inverse={active}>{displayed || (active ? ' ' : '(empty)')}{active && field.type !== 'choice' ? '▌' : ''}</Text>
  </Box>
}

function FormModal({ form, error }: { form: FormState; error?: string }) {
  const start = Math.max(0, form.active - 6)
  return <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} width="100%">
    <Text bold>{form.title}</Text>
    <Text dimColor>Tab/↑/↓ fields · ←/→ choices · Enter next/newline · Enter on Save submits · Ctrl+Shift+S/Alt+S · Esc cancel</Text>
    <Box flexDirection="column" marginTop={1}>
      {form.fields.slice(start, start + 13).map((field, offset) => (
        <TextField key={field.name} field={field} active={start + offset === form.active} />
      ))}
    </Box>
    {error ? <Text color="red" bold>Save failed: {error}</Text> : null}
  </Box>
}

function SelectorModal({ selector, error }: { selector: SelectorState; error?: string }) {
  const filtered = selectorChoices(selector)
  const selected = clamp(selector.selected, filtered.length)
  const start = Math.max(0, selected - 6)
  return <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} width="100%">
    <Text bold>{selector.title}</Text>
    <Text>Search: {selector.query}<Text inverse> </Text></Text>
    <Text dimColor>
      {selector.purpose === 'manualTask'
        ? 'Type to fuzzy-search tasks · choose General time log for meetings or other work · ↑/↓ · Enter'
        : 'Type to filter · ↑/↓ navigate · Enter select · Esc cancel'}
    </Text>
    <Box flexDirection="column" marginTop={1}>
      {filtered.length === 0 ? <Text dimColor>No matching options</Text> : filtered.slice(start, start + 13).map((item, offset) => {
        const active = start + offset === selected
        return <Text key={item.id} inverse={active}>{active ? '›' : ' '} {item.label}</Text>
      })}
    </Box>
    {error ? <Text color="red">Error: {error}</Text> : null}
  </Box>
}

function HelpModal({ screen }: { screen: Screen }) {
  return <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} width="100%">
    <Text bold>OZT Help · {screen === 'tasks' ? 'Tasks' : screen === 'time' ? 'Time Logs' : 'Settings'}</Text>
    <Text>1 Tasks  2 Time Logs  3 Settings  p Project  r Refresh  ? Help  q Quit</Text>
    {screen === 'tasks' ? <>
      <Text>/ Search  ↑/↓ Select  Enter Details  n New  e Edit  m Move</Text>
      <Text>t Start timer  a Add time  x Stop timer  X Cancel timer</Text>
    </> : null}
    {screen === 'time' ? <Text>↑/↓ Select  a Add task/general time  s Sync pending  x Stop timer  X Cancel timer</Text> : null}
    {screen === 'settings' ? <Text>↑/↓ Select  Enter Change/action  Delete Reset optional value</Text> : null}
    <Text dimColor>Press Esc or ? to close</Text>
  </Box>
}

function Header({ screen, project, timer, now }: {
  screen: Screen
  project?: Project | undefined
  timer?: ActiveTimer | undefined
  now: number
}) {
  return <Box flexDirection="column">
    <Box justifyContent="space-between">
      <Text bold color="cyan">OpenZohoTui</Text>
      <Text>{project ? `Project: ${project.name}` : 'No project selected'} · {timer ? `Timer ${formatElapsed(timer.startedAt, now)}` : 'Timer idle'}</Text>
    </Box>
    <Text>
      <Text inverse={screen === 'tasks'}> 1 Tasks </Text>{' '}
      <Text inverse={screen === 'time'}> 2 Time Logs </Text>{' '}
      <Text inverse={screen === 'settings'}> 3 Settings </Text>
    </Text>
  </Box>
}

function TaskScreen({ tasks, selected, query, searching, detail, wide, loading }: {
  tasks: Task[]
  selected: number
  query: string
  searching: boolean
  detail?: Task | undefined
  wide: boolean
  loading: boolean
}) {
  const current = tasks[selected]
  const list = <Box flexDirection="column" width={wide ? '58%' : '100%'} paddingRight={wide ? 1 : 0}>
    <Text>Search: {query}{searching ? <Text inverse> </Text> : null}</Text>
    <Text dimColor>{loading ? 'Refreshing…' : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`} · / search · n new · p project</Text>
    <Box flexDirection="column" marginTop={1}>
      {tasks.length === 0 && !loading ? <Text dimColor>No tasks found. Press n to create one.</Text> : tasks.slice(Math.max(0, selected - 8), selected + 9).map((task) => {
        const active = current?.id === task.id
        const key = task.key ?? task.id
        return <Text key={task.id} inverse={active} wrap="truncate-end">
          {active ? '›' : ' '} {key.padEnd(14)} {task.name} {task.status ? `· ${task.status.name}` : ''}
        </Text>
      })}
    </Box>
  </Box>
  if (!wide) return list
  const shown = detail?.id === current?.id ? detail : current
  return <Box>{list}<Box borderStyle="single" flexDirection="column" width="42%" paddingX={1}>
    {shown ? <>
      <Text bold>{shown.key ?? shown.id}</Text>
      <Text>{shown.name}</Text>
      <Text>Status: {shown.status?.name ?? 'Not set'}</Text>
      <Text>Task list: {shown.tasklist?.name ?? 'Not set'}</Text>
      {shown.priority ? <Text>Priority: {shown.priority}</Text> : null}
      {shown.due_date ? <Text>Due: {shown.due_date}</Text> : null}
      <Box marginTop={1}><Text wrap="wrap">{shown.description || 'No description'}</Text></Box>
      <Box marginTop={1}><Text dimColor>Enter details · e edit · m move · t timer · a add time</Text></Box>
    </> : <Text dimColor>Select a task</Text>}
  </Box></Box>
}

function TimeScreen({ logs, tasks, selected, timer, now, wide, loading }: {
  logs: PendingLog[]
  tasks: Task[]
  selected: number
  timer?: ActiveTimer | undefined
  now: number
  wide: boolean
  loading: boolean
}) {
  const orderedLogs = newestTimeLogs(logs)
  const current = orderedLogs[selected]
  const list = <Box flexDirection="column" width={wide ? '58%' : '100%'} paddingRight={wide ? 1 : 0}>
    <Text bold>Local time-log queue</Text>
    <Text dimColor>{loading ? 'Syncing…' : `${logs.length} records`} · a add task/general time · s sync pending</Text>
    {orderedLogs.length === 0 ? <Text dimColor>No local time logs yet.</Text> : orderedLogs.slice(Math.max(0, selected - 8), selected + 9).map((log, offset) => {
      const index = Math.max(0, selected - 8) + offset
      const task = taskForTimeLog(log, tasks)
      const target = log.generalName ? `General: ${log.generalName}` : task?.name ?? log.taskRef
      return <Text key={log.id} inverse={index === selected} wrap="truncate-end">
        {index === selected ? '›' : ' '} [{log.state}] {log.date} · {target} · {formatMinutes(log.minutes)} · {log.billing}
      </Text>
    })}
  </Box>

  return <Box flexDirection="column">
    {timer ? <Box borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text bold>Active: {timer.taskRef} · {formatElapsed(timer.startedAt, now)} · {timer.billing}</Text>
      <Text dimColor>  x stop · X cancel</Text>
    </Box> : <Text dimColor>No active timer</Text>}
    <Box marginTop={1}>
      {list}
      {wide ? <Box borderStyle="single" flexDirection="column" width="42%" paddingX={1}>
        {current ? <>
          <Text bold>Time log details</Text>
          {timeLogDetailRows(current, taskForTimeLog(current, tasks)).map(([label, value]) => (
            <Text key={label} wrap="wrap">{label}: {value}</Text>
          ))}
        </> : <Text dimColor>Select a time log</Text>}
      </Box> : null}
    </Box>
  </Box>
}

function SettingsScreen({ authenticated, config, selected, project, portal, tasklist }: {
  authenticated: boolean
  config?: Config | undefined
  selected: number
  project?: Project | undefined
  portal?: Portal | undefined
  tasklist?: TaskList | undefined
}) {
  const settings: [string, string][] = [
    ['Authentication', authenticated ? 'Signed in' : 'Not signed in'],
    ['Portal', portal ? portalName(portal) : config?.portalId ?? 'Not selected'],
    ['Project', project?.name ?? config?.projectId ?? 'Not selected'],
    ['Default task list', tasklist?.name ?? config?.tasklistId ?? 'Not selected'],
    ['Billing', config?.billing ?? 'Non Billable'],
    ['Timezone', config?.timezone ?? 'UTC'],
    ['Broker URL', config?.brokerUrl ?? 'Not set'],
    ['Projects API origin', config?.projectsApiOrigin ?? 'Broker default'],
    ['Accounts server', config?.accountsServer ?? 'Broker default'],
  ]
  return <Box flexDirection="column">
    <Text bold>Settings</Text>
    <Text dimColor>Enter change/action · Delete reset optional value · authentication changes require confirmation</Text>
    <Box flexDirection="column" marginTop={1}>
      {settings.map(([label, value], index) => <Text key={label} inverse={index === selected} wrap="truncate-end">
        {index === selected ? '›' : ' '} {label.padEnd(22)} {value}
      </Text>)}
    </Box>
    <Box marginTop={1}><Text dimColor>OZT 0.1.0 · Zoho Projects v3</Text></Box>
  </Box>
}

function App({ services }: { services: OztServices }) {
  const { exit } = useApp()
  const [screen, setScreen] = useState<Screen>('tasks')
  const [authenticated, setAuthenticated] = useState(false)
  const [config, setConfig] = useState<Config>()
  const [portals, setPortals] = useState<Portal[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskLists, setTaskLists] = useState<TaskList[]>([])
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [fields, setFields] = useState<ModuleField[]>([])
  const [logs, setLogs] = useState<PendingLog[]>([])
  const [timer, setTimer] = useState<ActiveTimer>()
  const [selectedTask, setSelectedTask] = useState(0)
  const [selectedLog, setSelectedLog] = useState(0)
  const [selectedSetting, setSelectedSetting] = useState(0)
  const [detail, setDetail] = useState<Task>()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [modal, setModal] = useState<Modal>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [toast, setToast] = useState<string>()
  const [now, setNow] = useState(Date.now())
  const generation = useRef(0)

  const visibleTasks = useMemo(() => filterTasks(tasks, query), [tasks, query])
  const currentTask = visibleTasks[clamp(selectedTask, visibleTasks.length)]
  const currentProject = projects.find(({ id }) => id === config?.projectId)
  const currentPortal = portals.find(({ id }) => id === config?.portalId)
  const currentTasklist = taskLists.find(({ id }) => id === config?.tasklistId)
  const wide = (process.stdout.columns ?? 100) >= 100

  async function bootstrap(refresh = false): Promise<void> {
    const request = ++generation.current
    setBusy(true)
    setError(undefined)
    try {
      const [nextConfig, nextAuthenticated, nextTimer, nextLogs] = await Promise.all([
        services.getConfig(), services.authStatus(), services.timerStatus(), services.listTimeLogs(),
      ])
      if (request !== generation.current) return
      setConfig(nextConfig)
      setAuthenticated(nextAuthenticated)
      setTimer(nextTimer)
      setLogs(nextLogs)
      if (!nextAuthenticated) {
        setScreen('settings')
        return
      }
      const nextPortals = await services.listPortals(refresh)
      if (request !== generation.current) return
      setPortals(nextPortals)
      if (!nextConfig.portalId) {
        setScreen('settings')
        return
      }
      const nextProjects = await services.listProjects(refresh)
      if (request !== generation.current) return
      setProjects(nextProjects)
      if (!nextConfig.projectId) {
        setScreen('settings')
        return
      }
      const [nextTasks, nextTaskLists] = await Promise.all([
        services.listTasks(refresh), services.listTaskLists(refresh).catch(() => []),
      ])
      if (request !== generation.current) return
      setTasks(nextTasks)
      setTaskLists(nextTaskLists)
      setSelectedTask((value) => clamp(value, nextTasks.length))
    } catch (reason) {
      if (request === generation.current) setError(errorMessage(reason))
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  useEffect(() => { void bootstrap() }, [])
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(interval)
  }, [])
  useEffect(() => {
    if (!toast) return
    const timeout = setTimeout(() => setToast(undefined), 4_000)
    return () => clearTimeout(timeout)
  }, [toast])
  useEffect(() => {
    if (modal?.kind !== 'login') return
    let cancelled = false
    const login = modal.login
    const poll = async () => {
      try {
        const result = await services.pollLogin(login.attemptId)
        if (cancelled) return
        if (result === 'authenticated') {
          setModal(undefined)
          setAuthenticated(true)
          setToast('Authenticated. Select your portal and project.')
          await bootstrap(true)
          const nextConfig = await services.getConfig()
          if (!nextConfig.portalId) await openSelector('portal')
          else if (!nextConfig.projectId) await openSelector('project')
        }
      } catch (reason) {
        if (!cancelled) setError(errorMessage(reason))
      }
    }
    const interval = setInterval(() => void poll(), Math.max(5_000, login.intervalMs))
    return () => { cancelled = true; clearInterval(interval) }
  }, [modal?.kind === 'login' ? modal.login.attemptId : undefined])

  function showError(reason: unknown): void {
    setError(errorMessage(reason))
    setBusy(false)
  }

  async function loadMetadata(): Promise<void> {
    const [nextTaskLists, nextStatuses, nextFields] = await Promise.all([
      services.listTaskLists().catch(() => []),
      services.listTaskStatuses().catch(() => []),
      services.listTaskFields().catch(() => []),
    ])
    setTaskLists(nextTaskLists)
    setStatuses(nextStatuses)
    setFields(nextFields)
  }

  function billingChoices(): Choice[] {
    return [{ id: 'Billable', label: 'Billable' }, { id: 'Non Billable', label: 'Non Billable' }]
  }

  function makeForm(input: Omit<FormState, 'active' | 'original'>): FormState {
    const fields: FormField[] = [
      ...input.fields,
      { name: '__save', label: 'Save', value: '', type: 'submit' },
    ]
    return { ...input, fields, active: 0, original: JSON.stringify(fields.map(({ value }) => value)) }
  }

  async function openCreate(): Promise<void> {
    if (!config?.projectId) return setError('Select a project before creating a task')
    setBusy(true)
    setError(undefined)
    try {
      await loadMetadata()
      const lists = await services.listTaskLists().catch(() => taskLists)
      const metadata = await services.listTaskFields().catch(() => fields)
      const formFields: FormField[] = [
        { name: 'name', label: 'Name', value: '', type: 'text', required: true },
        {
          name: 'tasklist', label: 'Task list', value: config.tasklistId ?? '', type: 'choice', required: true,
          options: [{ id: '', label: '(select task list)' }, ...lists.map(({ id, name }) => ({ id, label: name }))],
        },
        { name: 'description', label: 'Description', value: '', type: 'multiline' },
        ...customFields(metadata).map((field): FormField => {
          const options = fieldOptions(field)
          return {
            name: `custom:${field.api_name}`,
            label: field.display_name,
            value: '',
            type: options.length > 0 ? 'choice' : 'text',
            ...(field.is_mandatory !== undefined ? { required: field.is_mandatory } : {}),
            ...(options.length > 0 ? { options: [{ id: '', label: '(none)' }, ...options] } : {}),
          }
        }),
      ]
      setModal({ kind: 'form', form: makeForm({ kind: 'create', title: 'Create task', fields: formFields }) })
    } catch (reason) { showError(reason) } finally { setBusy(false) }
  }

  async function openEdit(task: Task): Promise<void> {
    setBusy(true)
    setError(undefined)
    try {
      let nextStatuses = await services.listTaskStatuses().catch(() => [] as TaskStatus[])
      if (nextStatuses.length === 0) {
        const unique = new Map<string, TaskStatus>()
        for (const item of tasks) if (item.status?.id) unique.set(item.status.id, { id: item.status.id, name: item.status.name })
        nextStatuses = [...unique.values()]
      }
      setStatuses(nextStatuses)
      const statusOptions = [
        { id: '', label: '(unchanged)' },
        ...nextStatuses.map(({ id, name }) => ({ id, label: name })),
      ]
      const form = makeForm({
        kind: 'edit', title: `Edit ${task.key ?? task.id}`, taskRef: task.id,
        fields: [
          { name: 'name', label: 'Name', value: task.name, type: 'text', required: true },
          { name: 'status', label: 'Status', value: task.status?.id ?? '', type: 'choice', options: statusOptions },
          { name: 'description', label: 'Description', value: task.description ?? '', type: 'multiline' },
        ],
      })
      setModal({ kind: 'form', form })
    } catch (reason) { showError(reason) } finally { setBusy(false) }
  }

  function openStart(task: Task): void {
    setModal({ kind: 'form', form: makeForm({
      kind: 'start', title: `Start timer · ${task.key ?? task.id}`, taskRef: task.id,
      fields: [
        { name: 'notes', label: 'Notes', value: '', type: 'text' },
        { name: 'billing', label: 'Billing', value: config?.billing ?? 'Non Billable', type: 'choice', options: billingChoices() },
      ],
    }) })
  }

  function openStop(): void {
    if (!timer) return setError('No active timer')
    const elapsed = Math.max(1, Math.round((Date.now() - new Date(timer.startedAt).getTime()) / 60_000))
    setModal({ kind: 'form', form: makeForm({
      kind: 'stop', title: `Stop timer · ${timer.taskRef}`, taskRef: timer.taskRef,
      fields: [
        { name: 'duration', label: 'Duration (30 = min; 1h; 1.5h)', value: String(elapsed), type: 'text', required: true },
        { name: 'date', label: 'Work date', value: today(config?.timezone), type: 'text', required: true },
        { name: 'notes', label: 'Notes', value: timer.notes ?? '', type: 'multiline' },
        { name: 'billing', label: 'Billing', value: timer.billing, type: 'choice', options: billingChoices() },
        { name: 'sync', label: 'After saving', value: 'local', type: 'choice', options: [
          { id: 'local', label: 'Save locally' }, { id: 'sync', label: 'Save and sync now' },
        ] },
      ],
    }) })
  }

  function openAdd(task: Task): void {
    setModal({ kind: 'form', form: makeForm({
      kind: 'add', title: `Add time · ${task.key ?? task.id}`, taskRef: task.id,
      fields: [
        { name: 'duration', label: 'Duration (30 = min; 1h; 1.5h)', value: '', type: 'text', required: true },
        { name: 'date', label: 'Work date', value: today(config?.timezone), type: 'text', required: true },
        { name: 'notes', label: 'Notes', value: '', type: 'multiline' },
        { name: 'billing', label: 'Billing', value: config?.billing ?? 'Non Billable', type: 'choice', options: billingChoices() },
        { name: 'sync', label: 'After saving', value: 'local', type: 'choice', options: [
          { id: 'local', label: 'Save locally' }, { id: 'sync', label: 'Save and sync now' },
        ] },
      ],
    }) })
  }

  function openGeneralAdd(initialName = ''): void {
    setModal({ kind: 'form', form: makeForm({
      kind: 'addGeneral', title: 'Add general time',
      fields: [
        { name: 'name', label: 'Activity name', value: initialName.trim(), type: 'text', required: true },
        { name: 'duration', label: 'Duration (30 = min; 1h; 1.5h)', value: '', type: 'text', required: true },
        { name: 'date', label: 'Work date', value: today(config?.timezone), type: 'text', required: true },
        { name: 'notes', label: 'Notes', value: '', type: 'multiline' },
        { name: 'billing', label: 'Billing', value: config?.billing ?? 'Non Billable', type: 'choice', options: billingChoices() },
        { name: 'sync', label: 'After saving', value: 'local', type: 'choice', options: [
          { id: 'local', label: 'Save locally' }, { id: 'sync', label: 'Save and sync now' },
        ] },
      ],
    }) })
  }

  async function openSelector(purpose: SelectorPurpose): Promise<void> {
    setBusy(true)
    setError(undefined)
    try {
      let title = ''
      let items: Choice[] = []
      if (purpose === 'portal') {
        const values = await services.listPortals()
        setPortals(values)
        title = 'Select portal'
        items = values.map((item) => ({ id: item.id, label: portalName(item) }))
      } else if (purpose === 'project') {
        const activeConfig = await services.getConfig()
        if (!activeConfig.portalId) throw new Error('Select a portal first')
        const values = await services.listProjects()
        setProjects(values)
        title = 'Select project'
        items = values.map(({ id, name }) => ({ id, label: name }))
      } else if (purpose === 'move' || purpose === 'defaultTasklist') {
        const activeConfig = await services.getConfig()
        if (!activeConfig.projectId) throw new Error('Select a project first')
        const values = await services.listTaskLists()
        setTaskLists(values)
        title = purpose === 'move' ? `Move ${currentTask?.key ?? 'task'} to task list` : 'Select default task list'
        items = [
          ...(purpose === 'defaultTasklist' ? [{ id: '', label: '(no default)' }] : []),
          ...values.map(({ id, name }) => ({ id, label: name })),
        ]
      } else {
        title = 'Select task or enter a general time log'
        items = tasks.map((task) => ({ id: task.id, label: `${task.key ?? task.id} · ${task.name}` }))
      }
      setModal({ kind: 'selector', purpose, title, items, selected: 0, query: '' })
    } catch (reason) { showError(reason) } finally { setBusy(false) }
  }

  function openConfig(key: keyof Config, label: string): void {
    setModal({ kind: 'form', form: makeForm({
      kind: 'config', title: `Set ${label}`, configKey: key,
      fields: [{ name: 'value', label, value: String(config?.[key] ?? ''), type: 'text', required: true }],
    }) })
  }

  async function submitForm(form: FormState): Promise<void> {
    const missing = form.fields.find((field) => field.required && !field.value.trim())
    if (missing) return setError(`${missing.label} is required`)
    setBusy(true)
    setError(undefined)
    try {
      if (form.kind === 'create') {
        const custom = Object.fromEntries(form.fields
          .filter(({ name, value }) => name.startsWith('custom:') && value !== '')
          .map(({ name, value }) => [name.slice('custom:'.length), value]))
        const created = await services.createTask({
          name: valueOf(form, 'name'),
          ...(valueOf(form, 'tasklist') ? { tasklistId: valueOf(form, 'tasklist') } : {}),
          ...(valueOf(form, 'description') ? { description: valueOf(form, 'description') } : {}),
          ...(Object.keys(custom).length > 0 ? { fields: custom } : {}),
        })
        setToast(`Created ${created.key ?? created.name}`)
        setTasks(await services.listTasks(true))
      } else if (form.kind === 'edit') {
        const updated = await services.updateTask(form.taskRef!, {
          name: valueOf(form, 'name'),
          ...(valueOf(form, 'status') ? { statusId: valueOf(form, 'status') } : {}),
          description: valueOf(form, 'description'),
        })
        setToast(`Updated ${updated.key ?? updated.name}`)
        setTasks(await services.listTasks(true))
        setDetail(updated)
      } else if (form.kind === 'start') {
        const started = await services.startTimer(form.taskRef!, {
          ...(valueOf(form, 'notes') ? { notes: valueOf(form, 'notes') } : {}),
          billing: valueOf(form, 'billing') as Billing,
        })
        setTimer(started)
        setToast(`Timer started for ${started.taskRef}`)
      } else if (form.kind === 'stop') {
        await services.stopTimer({
          duration: valueOf(form, 'duration'),
          date: valueOf(form, 'date'),
          notes: valueOf(form, 'notes'),
          billing: valueOf(form, 'billing') as Billing,
        })
        setTimer(undefined)
        setLogs(await services.listTimeLogs())
        if (valueOf(form, 'sync') === 'sync') {
          await services.syncTimeLogs()
          setLogs(await services.listTimeLogs())
        }
        setToast('Timer stopped and time saved')
      } else if (form.kind === 'add') {
        await services.addTime(form.taskRef!, {
          duration: valueOf(form, 'duration'),
          date: valueOf(form, 'date'),
          notes: valueOf(form, 'notes'),
          billing: valueOf(form, 'billing') as Billing,
        })
        setLogs(await services.listTimeLogs())
        if (valueOf(form, 'sync') === 'sync') {
          await services.syncTimeLogs()
          setLogs(await services.listTimeLogs())
        }
        setToast('Time entry saved')
      } else if (form.kind === 'addGeneral') {
        await services.addGeneralTime(valueOf(form, 'name'), {
          duration: valueOf(form, 'duration'),
          date: valueOf(form, 'date'),
          notes: valueOf(form, 'notes'),
          billing: valueOf(form, 'billing') as Billing,
        })
        setLogs(await services.listTimeLogs())
        if (valueOf(form, 'sync') === 'sync') {
          await services.syncTimeLogs()
          setLogs(await services.listTimeLogs())
        }
        setToast('General time entry saved')
      } else if (form.kind === 'config') {
        const next = await services.setConfig(form.configKey!, valueOf(form, 'value'))
        setConfig(next)
        setToast('Setting updated')
      }
      setModal(undefined)
    } catch (reason) { showError(reason) } finally { setBusy(false) }
  }

  async function selectItem(selector: SelectorState): Promise<void> {
    const items = selectorChoices(selector)
    const item = items[clamp(selector.selected, items.length)]
    if (!item) return
    setBusy(true)
    setError(undefined)
    try {
      if (selector.purpose === 'portal') {
        const next = await services.selectPortal(item.id)
        setConfig(next)
        setProjects([])
        setTasks([])
        setTaskLists([])
        setModal(undefined)
        setToast(`Portal changed to ${item.label}`)
        await openSelector('project')
        return
      }
      if (selector.purpose === 'project') {
        const next = await services.selectProject(item.id)
        setConfig(next)
        setModal(undefined)
        setToast(`Project changed to ${item.label}`)
        await bootstrap(true)
        setScreen('tasks')
        return
      }
      if (selector.purpose === 'move') {
        if (!currentTask) throw new Error('No task selected')
        const updated = await services.moveTask(currentTask.id, item.id)
        setTasks(await services.listTasks(true))
        setDetail(updated)
        setModal(undefined)
        setToast(`Moved to ${item.label}`)
        return
      }
      if (selector.purpose === 'defaultTasklist') {
        const next = item.id ? await services.setConfig('tasklistId', item.id) : await services.unsetConfig('tasklistId')
        setConfig(next)
        setModal(undefined)
        setToast('Default task list updated')
        return
      }
      if (item.id === generalTimeChoiceId) {
        openGeneralAdd(selector.query)
        return
      }
      const selected = tasks.find(({ id }) => id === item.id)
      if (selected) openAdd(selected)
    } catch (reason) { showError(reason) } finally { setBusy(false) }
  }

  async function confirm(action: ConfirmAction): Promise<void> {
    setBusy(true)
    setError(undefined)
    try {
      if (action === 'cancelTimer') {
        await services.cancelTimer()
        setTimer(undefined)
        setToast('Timer cancelled')
      } else if (action === 'logout') {
        await services.logout()
        setAuthenticated(false)
        setTasks([])
        setProjects([])
        setPortals([])
        setScreen('settings')
        setToast('Logged out')
      }
      setModal(undefined)
    } catch (reason) { showError(reason) } finally { setBusy(false) }
  }

  async function beginLogin(): Promise<void> {
    setBusy(true)
    setError(undefined)
    try {
      const login = await services.beginLogin()
      setModal({ kind: 'login', login, startedAt: Date.now() })
    } catch (reason) { showError(reason) } finally { setBusy(false) }
  }

  function changeForm(mutator: (form: FormState) => FormState): void {
    setModal((current) => current?.kind === 'form' ? { kind: 'form', form: mutator(current.form) } : current)
  }

  useInput((input, key) => {
    setError(undefined)
    if (busy) return

    if (modal?.kind === 'help') {
      if (key.escape || input === '?') setModal(undefined)
      return
    }
    if (modal?.kind === 'login') {
      if (key.escape) setModal(undefined)
      return
    }
    if (modal?.kind === 'confirm') {
      if (input.toLowerCase() === 'y' || key.return) void confirm(modal.action)
      else if (input.toLowerCase() === 'n' || key.escape) {
        setModal(modal.returnForm ? { kind: 'form', form: modal.returnForm } : undefined)
      }
      return
    }
    if (modal?.kind === 'selector') {
      if (key.escape) return setModal(undefined)
      if (key.upArrow) return setModal({ ...modal, selected: Math.max(0, modal.selected - 1) })
      if (key.downArrow) return setModal({ ...modal, selected: modal.selected + 1 })
      if (key.backspace || key.delete) return setModal({ ...modal, query: modal.query.slice(0, -1), selected: 0 })
      if (key.return) return void selectItem(modal)
      if (input && !key.ctrl && !key.meta) setModal({ ...modal, query: modal.query + input, selected: 0 })
      return
    }
    if (modal?.kind === 'form') {
      const form = modal.form
      if (key.escape) {
        const dirty = JSON.stringify(form.fields.map(({ value }) => value)) !== form.original
        return dirty
          ? setModal({ kind: 'confirm', action: 'discardForm', message: 'Discard unsaved changes?', returnForm: form })
          : setModal(undefined)
      }
      if (isSaveShortcut(input, key)) return void submitForm(form)
      if (key.tab || key.upArrow || key.downArrow) {
        const direction = key.shift || key.upArrow ? -1 : 1
        return changeForm((current) => ({ ...current, active: clamp(current.active + direction, current.fields.length) }))
      }
      const field = form.fields[form.active]
      if (!field) return
      if (field.type === 'submit') {
        if (key.return) return void submitForm(form)
        return
      }
      if (field.type === 'choice') {
        if (key.leftArrow || key.rightArrow || key.return || input === ' ') {
          const options = field.options ?? []
          const current = Math.max(0, options.findIndex(({ id }) => id === field.value))
          const direction = key.leftArrow ? -1 : 1
          const option = options[(current + direction + options.length) % options.length]
          if (option) changeForm((state) => ({
            ...state,
            fields: state.fields.map((item, index) => index === state.active ? { ...item, value: option.id } : item),
          }))
        }
        return
      }
      if (key.return) {
        if (field.type === 'multiline') {
          return changeForm((state) => ({
            ...state,
            fields: state.fields.map((item, index) => index === state.active ? { ...item, value: `${item.value}\n` } : item),
          }))
        }
        return changeForm((state) => ({ ...state, active: clamp(state.active + 1, state.fields.length) }))
      }
      if (key.backspace || key.delete) {
        return changeForm((state) => ({
          ...state,
          fields: state.fields.map((item, index) => index === state.active ? { ...item, value: item.value.slice(0, -1) } : item),
        }))
      }
      if (input && !key.ctrl && !key.meta) changeForm((state) => ({
        ...state,
        fields: state.fields.map((item, index) => index === state.active ? { ...item, value: item.value + input } : item),
      }))
      return
    }

    if (searching) {
      if (key.escape || key.return) return setSearching(false)
      if (key.backspace || key.delete) setQuery((value) => value.slice(0, -1))
      else if (input && !key.ctrl && !key.meta) setQuery((value) => value + input)
      setSelectedTask(0)
      return
    }

    if (input === '?') return setModal({ kind: 'help' })
    if (input === '1') return setScreen('tasks')
    if (input === '2') return setScreen('time')
    if (input === '3') return setScreen('settings')
    if (input === 'p') return void openSelector('project')
    if (input === 'r') return void bootstrap(true)
    if (input === 'q' || key.escape) return exit()
    if (input === 'x') return openStop()
    if (input === 'X' && timer) return setModal({ kind: 'confirm', action: 'cancelTimer', message: `Cancel timer for ${timer.taskRef}?` })

    if (screen === 'tasks') {
      if (input === '/') return setSearching(true)
      if (key.upArrow) return setSelectedTask((value) => clamp(value - 1, visibleTasks.length))
      if (key.downArrow) return setSelectedTask((value) => clamp(value + 1, visibleTasks.length))
      if (input === 'n') return void openCreate()
      if (input === 'e' && currentTask) return void openEdit(currentTask)
      if (input === 'm' && currentTask) return void openSelector('move')
      if (input === 't' && currentTask) return timer ? setError(`Timer already active for ${timer.taskRef}`) : openStart(currentTask)
      if (input === 'a' && currentTask) return openAdd(currentTask)
      if (key.return && currentTask) {
        setBusy(true)
        void services.showTask(currentTask.id).then(setDetail, showError).finally(() => setBusy(false))
      }
      return
    }
    if (screen === 'time') {
      if (key.upArrow) return setSelectedLog((value) => clamp(value - 1, logs.length))
      if (key.downArrow) return setSelectedLog((value) => clamp(value + 1, logs.length))
      if (input === 'a') return void openSelector('manualTask')
      if (input === 's') {
        setBusy(true)
        void services.syncTimeLogs(() => void services.listTimeLogs().then(setLogs))
          .then(() => services.listTimeLogs()).then(setLogs, showError).finally(() => setBusy(false))
      }
      return
    }
    if (screen === 'settings') {
      if (key.upArrow) return setSelectedSetting((value) => clamp(value - 1, 9))
      if (key.downArrow) return setSelectedSetting((value) => clamp(value + 1, 9))
      if (key.delete && selectedSetting >= 3) {
        const keys: (keyof Config | undefined)[] = [undefined, undefined, undefined, 'tasklistId', 'billing', 'timezone', undefined, 'projectsApiOrigin', 'accountsServer']
        const setting = keys[selectedSetting]
        if (setting) {
          setBusy(true)
          void services.unsetConfig(setting).then((next) => { setConfig(next); setToast(`Reset ${setting}`) }, showError).finally(() => setBusy(false))
        }
        return
      }
      if (!key.return) return
      if (selectedSetting === 0) {
        return authenticated
          ? setModal({ kind: 'confirm', action: 'logout', message: 'Log out and revoke the local Zoho credential?' })
          : void beginLogin()
      }
      if (selectedSetting === 1) return void openSelector('portal')
      if (selectedSetting === 2) return void openSelector('project')
      if (selectedSetting === 3) return void openSelector('defaultTasklist')
      if (selectedSetting === 4) {
        const next = config?.billing === 'Billable' ? 'Non Billable' : 'Billable'
        setBusy(true)
        void services.setConfig('billing', next).then((value) => { setConfig(value); setToast(`Billing set to ${next}`) }, showError).finally(() => setBusy(false))
        return
      }
      if (selectedSetting === 5) return openConfig('timezone', 'Timezone')
      if (selectedSetting === 6) return openConfig('brokerUrl', 'Broker URL')
      if (selectedSetting === 7) return openConfig('projectsApiOrigin', 'Projects API origin')
      if (selectedSetting === 8) return openConfig('accountsServer', 'Accounts server')
    }
  })

  let content: React.ReactNode
  if (screen === 'tasks') content = <TaskScreen
    tasks={visibleTasks} selected={clamp(selectedTask, visibleTasks.length)} query={query} searching={searching}
    detail={detail} wide={wide} loading={busy}
  />
  else if (screen === 'time') content = <TimeScreen
    logs={logs} tasks={tasks} selected={clamp(selectedLog, logs.length)} timer={timer} now={now} wide={wide} loading={busy}
  />
  else content = <SettingsScreen
    authenticated={authenticated} config={config} selected={selectedSetting} project={currentProject}
    portal={currentPortal} tasklist={currentTasklist}
  />

  return <Box flexDirection="column" paddingX={1}>
    <Header screen={screen} project={currentProject} timer={timer} now={now} />
    <Box marginTop={1} flexDirection="column">
      {!authenticated ? <Text color="yellow">Not signed in. Open Settings and press Enter on Authentication.</Text> : null}
      {authenticated && !config?.portalId ? <Text color="yellow">Select a portal in Settings.</Text> : null}
      {authenticated && config?.portalId && !config.projectId ? <Text color="yellow">Select a project in Settings.</Text> : null}
      {content}
    </Box>
    {toast ? <Box marginTop={1}><Text color="green">Success: {toast}</Text></Box> : null}
    {error && !modal ? <Box marginTop={1}><Text color="red">Error: {error}</Text></Box> : null}
    {busy ? <Text dimColor>Working…</Text> : null}
    <Box marginTop={1}><Text dimColor>1/2/3 views · p project · r refresh · ? help · q quit</Text></Box>
    {modal ? <Box marginTop={1}>
      {modal.kind === 'help' ? <HelpModal screen={screen} /> : null}
      {modal.kind === 'selector' ? <SelectorModal selector={modal} {...(error ? { error } : {})} /> : null}
      {modal.kind === 'form' ? <FormModal form={modal.form} {...(error ? { error } : {})} /> : null}
      {modal.kind === 'confirm' ? <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column" width="100%">
        <Text bold>{modal.message}</Text><Text>Enter/y confirm · n/Esc cancel</Text>
      </Box> : null}
      {modal.kind === 'login' ? <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width="100%">
        <Text bold>Authorize OZT with Zoho</Text>
        <Text>Open: {modal.login.verificationUrlComplete ?? modal.login.verificationUrl}</Text>
        <Text>Verification code: <Text bold color="cyan">{modal.login.userCode}</Text></Text>
        <Text dimColor>Waiting for authorization… · Esc close</Text>
      </Box> : null}
    </Box> : null}
  </Box>
}

export async function runTui(services: OztServices): Promise<void> {
  const alternateScreen = Boolean(process.stdout.isTTY)
  if (alternateScreen) process.stdout.write('\u001B[?1049h\u001B[?25l')
  try {
    const instance = render(<App services={services} />, {
      exitOnCtrlC: true,
      kittyKeyboard: { mode: 'auto' },
    })
    await instance.waitUntilExit()
  } finally {
    if (alternateScreen) process.stdout.write('\u001B[?25h\u001B[?1049l')
  }
}
