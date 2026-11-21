/**
 * Value-changing API calls must come from the casino's own pages. The session
 * cookie alone can't prove that: SameSite=Lax still sends it from any
 * *.avmg.nl page (same site), and SameSite=None from anywhere. A browser
 * labels every request with Sec-Fetch-Site; older ones still send Origin.
 */
export function isForeignRequest(headers: { secFetchSite?: string, origin?: string }, host: string): boolean {
    if (headers.secFetchSite) return headers.secFetchSite !== 'same-origin' && headers.secFetchSite !== 'none'
    // No Origin: not a browser's cross-site request (curl, scripts), and those carry no victim's cookie.
    if (!headers.origin) return false
    try {
        return new URL(headers.origin).host !== host
    } catch {
        return true
    }
}
