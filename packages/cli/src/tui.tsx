import React, { useEffect, useState } from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'
import type { Task } from '@open-zoho-connect/zoho-client'

function App({ load }: { load: () => Promise<Task[]> }) {
  const { exit } = useApp()
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState<string>()
  const [selected, setSelected] = useState(0)
  useEffect(() => { void load().then(setTasks, (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))) }, [load])
  useInput((_input, key) => {
    if (key.escape || _input === 'q') exit()
    if (key.upArrow) setSelected((value) => Math.max(0, value - 1))
    if (key.downArrow) setSelected((value) => Math.min(tasks.length - 1, value + 1))
  })
  if (error) return <Text color="red">{error}</Text>
  if (tasks.length === 0) return <Text dimColor>Loading assigned tasks...</Text>
  return <Box flexDirection="column">
    <Text bold color="cyan">OpenZohoConnect</Text>
    <Text dimColor>Assigned tasks · ↑/↓ navigate · q quit</Text>
    <Box flexDirection="column" marginTop={1}>
      {tasks.slice(Math.max(0, selected - 8), selected + 9).map((task) => {
        const active = tasks[selected]?.id === task.id
        return <Text key={task.id} inverse={active}>
          {active ? '›' : ' '} {(task.key ?? task.id).padEnd(14)} {task.name} {task.status ? `· ${task.status.name}` : ''}
        </Text>
      })}
    </Box>
  </Box>
}

export async function runTui(load: () => Promise<Task[]>): Promise<void> {
  const instance = render(<App load={load} />)
  await instance.waitUntilExit()
}
