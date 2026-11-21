/** The message to show for a failed API call. */
export function apiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
    const e = error as { data?: { statusMessage?: string, message?: string }, statusMessage?: string, message?: string }
    return e?.data?.statusMessage || e?.data?.message || e?.statusMessage || fallback
}

export function apiStatus(error: unknown): number | undefined {
    const e = error as { statusCode?: number, status?: number, response?: { status?: number } }
    return e?.statusCode ?? e?.status ?? e?.response?.status
}
