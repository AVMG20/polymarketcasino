import { sqlite } from '#server/database'

/** Liveness for the container: the process answers and SQLite reads. */
export default defineEventHandler((event) => {
    try {
        sqlite.query('select 1').get()
        return { ok: true }
    } catch (error) {
        setResponseStatus(event, 503)
        return { ok: false, error: (error as Error).message }
    }
})
