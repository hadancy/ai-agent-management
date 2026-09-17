import type { FastifyInstance } from 'fastify'
import { POWER_HISTORY_DAY_MS } from '../../shared/power-history'
import type { AppDatabase } from './database'

export function registerPowerHistoryRoutes(app: FastifyInstance, database: AppDatabase): void {
  app.get<{ Querystring: { start?: string; end?: string } }>(
    '/api/telemetry/power-history',
    async (request, reply) => {
      const start = Date.parse(request.query.start ?? '')
      const end = Date.parse(request.query.end ?? '')
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start ||
        end - start > POWER_HISTORY_DAY_MS
      ) {
        return reply.code(400).send({ message: '请提供有效起止时间，查询范围最多 24 小时' })
      }
      return {
        points: database.listPowerHistory(
          new Date(start).toISOString(),
          new Date(end).toISOString()
        )
      }
    }
  )
}
