import { listTasks, resetDb } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Wipes local state back to the seed so a run starts from a known tree. */
export async function POST(): Promise<Response> {
  await resetDb()
  return Response.json({ tasks: await listTasks() })
}
