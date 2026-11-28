package ca.takatak.foodhub.tablet

/** Best-effort evidence of a native queue read, independent of the WebView and the printer. */
internal class PrintListenerEvidence {
    private var lastAttemptAt: Long? = null

    // Keep this rate limit across configuration changes. It also bounds retries on old servers without the route.
    fun afterRead(scope: QueueScope, location: String, cookies: String?, now: Long): Observation? {
        if (location.isBlank() || lastAttemptAt?.let { now - it < 60_000L } == true) return null
        val enrollment = enrollmentCookie(cookies) ?: return null
        lastAttemptAt = now
        return Observation(scope, location, enrollment)
    }

    // A regular class avoids exposing the enrollment in a generated toString().
    class Observation(val scope: QueueScope, val location: String, private val enrollment: String) {
        fun matches(configured: QueueScope?, confirmed: QueueScope?, confirmedLocation: String?): Boolean =
            scope == configured && scope == confirmed && location == confirmedLocation

        fun currentEnrollment(cookies: String?): String? = enrollmentCookie(cookies)?.takeIf { it == enrollment }
    }

    private companion object {
        fun enrollmentCookie(cookies: String?): String? = cookies?.split(';')
            ?.asSequence()
            ?.map { it.trim() }
            ?.firstOrNull { it.startsWith("takatak_device=") }
            ?.takeIf { it.substringAfter('=').isNotBlank() }
    }
}
