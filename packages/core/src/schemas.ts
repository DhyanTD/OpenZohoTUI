import { z } from 'zod'

export const billingSchema = z.enum(['Billable', 'Non Billable'])

export const configSchema = z.object({
  brokerUrl: z.url(),
  portalId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  tasklistId: z.string().min(1).optional(),
  billing: billingSchema.optional(),
  timezone: z.string().min(1).optional(),
  projectsApiOrigin: z.url().optional(),
  accountsServer: z.url().optional(),
})
export type Config = z.infer<typeof configSchema>

export const credentialSchema = z.object({
  refreshToken: z.string().min(1),
  brokerCredential: z.string().min(1),
  accountsServer: z.url(),
  apiDomain: z.url(),
  projectsApiOrigin: z.url(),
})
export type Credential = z.infer<typeof credentialSchema>

export const activeTimerSchema = z.object({
  id: z.uuid(),
  taskRef: z.string().min(1),
  projectId: z.string().min(1),
  startedAt: z.iso.datetime(),
  notes: z.string().optional(),
  billing: billingSchema,
})
export type ActiveTimer = z.infer<typeof activeTimerSchema>

export const pendingLogSchema = z.object({
  id: z.uuid(),
  taskRef: z.string().min(1).optional(),
  generalName: z.string().trim().min(1).max(1000).optional(),
  projectId: z.string().min(1),
  date: z.iso.date(),
  minutes: z.number().int().positive(),
  notes: z.string(),
  billing: billingSchema,
  state: z.enum(['pending', 'submitting', 'uncertain', 'submitted', 'needs_review']),
  createdAt: z.iso.datetime(),
  zohoId: z.string().optional(),
  lastError: z.string().optional(),
}).superRefine((log, context) => {
  if (Boolean(log.taskRef) === Boolean(log.generalName)) {
    context.addIssue({
      code: 'custom',
      message: 'A time log must target exactly one task or general activity',
      path: ['taskRef'],
    })
  }
})
export type PendingLog = z.infer<typeof pendingLogSchema>

export const localStateSchema = z.object({
  activeTimer: activeTimerSchema.optional(),
  pendingLogs: z.array(pendingLogSchema).default([]),
})
export type LocalState = z.infer<typeof localStateSchema>
