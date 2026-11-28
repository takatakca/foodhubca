package ca.takatak.foodhub.tablet

import com.sun.net.httpserver.HttpServer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicReference

class PrintListenerEvidenceTest {
    private val automatic = QueueScope("https://hub.example", "", "install-1")
    private val enrolled = "takatak_device=synthetic-signed"
    private val staff = "takatak_session=synthetic-staff"

    @Test fun onlyAReadWithDeviceEnrollmentAndAResolvedKitchenCanBeReported() {
        val evidence = PrintListenerEvidence()
        assertNull(evidence.afterRead(automatic, "A", staff, 0L))
        assertNull(evidence.afterRead(automatic, "A", "not_takatak_device=other", 0L))
        assertNull(evidence.afterRead(automatic, "A", "takatak_device=; $staff", 0L))
        assertNull(evidence.afterRead(automatic, "", enrolled, 0L))
        assertNotNull(evidence.afterRead(automatic, "A", "$staff; $enrolled", 0L))
    }

    @Test fun onlyTheExactDeviceCookieUsedForTheReadCanBeSent() {
        val observation = requireNotNull(PrintListenerEvidence().afterRead(automatic, "A", "$staff; $enrolled", 0L))
        assertEquals(enrolled, observation.currentEnrollment("$enrolled; takatak_session=new-staff"))
        assertNull(observation.currentEnrollment(staff))
        assertNull(observation.currentEnrollment("takatak_device=other-enrollment; $staff"))
    }

    @Test fun scopeIsCheckedAgainstCurrentConfigurationAndTheLastResolvedQueue() {
        val observation = requireNotNull(PrintListenerEvidence().afterRead(automatic, "A", enrolled, 0L))
        val newOrigin = automatic.copy(origin = "https://other.example")
        val newInstallation = automatic.copy(deviceId = "install-2")
        val newSelection = automatic.copy(location = "B")
        assertTrue(observation.matches(automatic, automatic, "A"))
        assertFalse(observation.matches(newOrigin, automatic, "A"))
        assertFalse(observation.matches(newInstallation, automatic, "A"))
        assertFalse(observation.matches(newSelection, automatic, "A"))
        assertFalse(observation.matches(automatic, newSelection, "A"))
        assertFalse(observation.matches(automatic, automatic, "B"))
        assertFalse(observation.matches(automatic, automatic, null))
    }

    @Test fun attemptsAreBoundedAcrossFailuresAndScopeChanges() {
        val evidence = PrintListenerEvidence()
        val moved = automatic.copy(location = "B")
        assertNotNull(evidence.afterRead(automatic, "A", enrolled, 100L))
        assertNull(evidence.afterRead(automatic, "A", enrolled, 1_000L))
        assertNull(evidence.afterRead(moved, "B", enrolled, 60_099L))
        val retry = requireNotNull(evidence.afterRead(moved, "B", enrolled, 60_100L))
        assertTrue(retry.matches(moved, moved, "B"))
        assertFalse(retry.matches(automatic, automatic, "A"))
    }

    @Test fun dedicatedRequestSendsOnlyTheEnrollmentAndDoesNotFollowRedirects() {
        data class Request(val method: String, val cookie: String?, val body: String)
        val sent = AtomicReference<Request>()
        val redirectedCookie = AtomicReference<String>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/foodhub/devices/print-listener") { exchange ->
            exchange.use {
                sent.set(Request(it.requestMethod, it.requestHeaders.getFirst("Cookie"), it.requestBody.bufferedReader().readText()))
                it.responseHeaders.add("Location", "/unexpected")
                it.sendResponseHeaders(307, -1)
            }
        }
        server.createContext("/unexpected") { exchange ->
            exchange.use {
                redirectedCookie.set(it.requestHeaders.getFirst("Cookie"))
                it.sendResponseHeaders(204, -1)
            }
        }
        server.start()
        try {
            val origin = "http://127.0.0.1:${server.address.port}"
            val scope = automatic.copy(origin = origin)
            val observation = requireNotNull(PrintListenerEvidence().afterRead(scope, "A", "$staff; $enrolled", 0L))
            var configured = true
            val api = FoodHubApi(origin, {
                configured = false
                "$staff; $enrolled"
            }, "FoodHubTablet-test")
            assertThrows(FoodHubApi.ApiError::class.java) { api.reportPrintListener(observation) { configured } }
            assertNull(sent.get())

            val current = FoodHubApi(origin, { "$staff; $enrolled" }, "FoodHubTablet-test")
            val failure = assertThrows(FoodHubApi.ApiError::class.java) { current.reportPrintListener(observation) { true } }
            assertEquals(307, failure.status)
            assertEquals("POST", sent.get().method)
            assertEquals(enrolled, sent.get().cookie)
            assertEquals(setOf("locationCode"), JSONObject(sent.get().body).keySet())
            assertEquals("A", JSONObject(sent.get().body).getString("locationCode"))
            assertNull(redirectedCookie.get())
        } finally {
            server.stop(0)
        }
    }
}
