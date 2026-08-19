#!/usr/bin/env node
import { Command, Option } from 'commander'
import { billingSchema } from '@open-zoho-tui/core'
import { ZohoError } from '@open-zoho-tui/zoho-client'
import { isConfigKey, OztServices } from './services.js'
import { runTui } from './tui.js'

const program = new Command().name('ozt').description('Zoho Projects team CLI').version('0.1.0')
program.option('--json', 'emit machine-readable JSON').option('--no-input', 'never prompt')
const services = new OztServices()

function output(value: unknown): void {
  if (program.opts().json) process.stdout.write(`${JSON.stringify(value)}\n`)
  else if (typeof value === 'string') process.stdout.write(`${value}\n`)
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

const auth = program.command('auth')
auth.command('login').action(async () => {
  await services.login((start) => {
    if (program.opts().json) output(start)
    else output(`Open ${start.verificationUrlComplete ?? start.verificationUrl}\nVerification code: ${start.userCode}`)
  })
  output(program.opts().json ? { authenticated: true } : 'Authenticated')
})
auth.command('status').action(async () => output({ authenticated: await services.authStatus() }))
auth.command('logout').action(async () => {
  await services.logout()
  output(program.opts().json ? { authenticated: false } : 'Logged out')
})

const config = program.command('config')
config.command('get').argument('[key]').action(async (key?: string) => {
  const value = await services.getConfig()
  if (!key) return output(value)
  if (!isConfigKey(key)) throw new Error(`Unknown configuration key: ${key}`)
  output(value[key] ?? null)
})
config.command('set').argument('<key>').argument('<value>').action(async (key: string, value: string) => {
  if (!isConfigKey(key)) throw new Error(`Unknown configuration key: ${key}`)
  const next = await services.setConfig(key, value)
  output(program.opts().json ? next : `Set ${key}`)
})
config.command('unset').argument('<key>').action(async (key: string) => {
  if (!isConfigKey(key)) throw new Error(`Unknown configuration key: ${key}`)
  const next = await services.unsetConfig(key)
  output(program.opts().json ? next : `Unset ${key}`)
})

program.command('init').requiredOption('--portal <id>').option('--project <id>').option('--tasklist <id>')
  .addOption(new Option('--billing <value>').choices(['Billable', 'Non Billable']))
  .option('--timezone <iana>').action(async (options) => {
    const input = {
      portalId: String(options.portal),
      ...(options.project ? { projectId: String(options.project) } : {}),
      ...(options.tasklist ? { tasklistId: String(options.tasklist) } : {}),
      ...(options.billing ? { billing: billingSchema.parse(options.billing) } : {}),
      ...(options.timezone ? { timezone: String(options.timezone) } : {}),
    }
    const next = await services.initialize(input)
    output(program.opts().json ? next : 'Configuration initialized')
  })

const task = program.command('task')
task.command('list').action(async () => output(await services.listTasks()))
task.command('show').argument('<reference>').action(async (reference: string) => output(await services.showTask(reference)))
task.command('create').requiredOption('--name <name>').option('--tasklist <id>').option('--description <text>')
  .option('--field <name=value...>').action(async (options) => {
    const fields = Object.fromEntries((options.field ?? []).map((entry: string) => {
      const index = entry.indexOf('=')
      if (index < 1) throw new Error(`Invalid custom field: ${entry}`)
      return [entry.slice(0, index), entry.slice(index + 1)]
    }))
    output(await services.createTask({
      name: options.name,
      ...(options.tasklist ? { tasklistId: options.tasklist } : {}),
      ...(options.description ? { description: options.description } : {}),
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
    }))
  })
task.command('update').argument('<reference>').option('--name <name>').option('--status <id>').option('--description <text>')
  .action(async (reference: string, options) => output(await services.updateTask(reference, {
    ...(options.name ? { name: options.name } : {}),
    ...(options.status ? { statusId: options.status } : {}),
    ...(options.description ? { description: options.description } : {}),
  })))
task.command('move').argument('<reference>').requiredOption('--tasklist <id>')
  .action(async (reference: string, options) => output(await services.moveTask(reference, options.tasklist)))

const time = program.command('time')
time.command('start').argument('<task>').option('--notes <text>')
  .addOption(new Option('--billing <value>').choices(['Billable', 'Non Billable']))
  .action(async (taskRef: string, options) => output(await services.startTimer(taskRef, {
    ...(options.notes ? { notes: options.notes } : {}),
    ...(options.billing ? { billing: billingSchema.parse(options.billing) } : {}),
  })))
time.command('status').action(async () => output(await services.timerStatus() ?? { active: false }))
time.command('cancel').action(async () => {
  await services.cancelTimer()
  output(program.opts().json ? { active: false } : 'Timer cancelled')
})
time.command('stop').option('--duration <duration>').action(async (options) => output(await services.stopTimer({
  ...(options.duration ? { duration: options.duration } : {}),
})))
time.command('add').argument('<task>').requiredOption('--duration <duration>').option('--date <yyyy-mm-dd>')
  .option('--notes <text>').addOption(new Option('--billing <value>').choices(['Billable', 'Non Billable']))
  .action(async (taskRef: string, options) => output(await services.addTime(taskRef, {
    duration: options.duration,
    ...(options.date ? { date: options.date } : {}),
    ...(options.notes ? { notes: options.notes } : {}),
    ...(options.billing ? { billing: billingSchema.parse(options.billing) } : {}),
  })))
time.command('list').action(async () => output(await services.listTimeLogs()))
time.command('sync').action(async () => output(await services.syncTimeLogs()))

async function main(): Promise<void> {
  if (process.argv.length === 2) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      program.outputHelp()
      throw new Error('The interactive TUI requires a terminal; use an ozt subcommand for automation')
    }
    return runTui(services)
  }
  await program.parseAsync(process.argv)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  if (program.opts().json) process.stdout.write(`${JSON.stringify({ error: message })}\n`)
  else process.stderr.write(`Error: ${message}\n`)
  process.exitCode = error instanceof ZohoError && error.retryable ? 75 : 1
})
