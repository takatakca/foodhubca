package ca.takatak.foodhub.tablet

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

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
        val loopback = InetAddress.getByName("127.0.0.1")
        val executor = Executors.newSingleThreadExecutor()
        try {
            ServerSocket(0, 1, loopback).use { server ->
                ServerSocket(0, 1, loopback).use { redirect ->
                    server.soTimeout = 3_000
                    redirect.soTimeout = 250
                    val fixture = executor.submit {
                        server.accept().use { socket ->
                            socket.soTimeout = 3_000
                            val input = socket.getInputStream().bufferedReader()
                            assertEquals("POST /api/foodhub/devices/print-listener HTTP/1.1", input.readLine())
                            val headers = generateSequence(input::readLine).takeWhile(String::isNotEmpty)
                                .associate { it.substringBefore(':').lowercase() to it.substringAfter(':').trim() }
                            assertEquals(enrolled, headers["cookie"])
                            val payload = CharArray(headers.getValue("content-length").toInt()) { input.read().toChar() }.concatToString()
                            val body = JSONObject(payload)
                            assertEquals(setOf("locationCode"), body.keySet())
                            assertEquals("A", body.getString("locationCode"))
                            val target = "http://127.0.0.1:${redirect.localPort}/unexpected"
                            val response = "HTTP/1.1 307 Temporary Redirect\r\nLocation: $target\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                            socket.getOutputStream().apply { write(response.toByteArray()); flush() }
                        }
                    }

                    val origin = "http://127.0.0.1:${server.localPort}"
                    val scope = automatic.copy(origin = origin)
                    val observation = requireNotNull(PrintListenerEvidence().afterRead(scope, "A", "$staff; $enrolled", 0L))
                    var configured = true
                    val api = FoodHubApi(origin, {
                        configured = false
                        "$staff; $enrolled"
                    }, "FoodHubTablet-test")
                    val changed = assertThrows(FoodHubApi.ApiError::class.java) { api.reportPrintListener(observation) { configured } }
                    assertEquals("Print queue scope changed", changed.message)
                    assertFalse(fixture.isDone)

                    val current = FoodHubApi(origin, { "$staff; $enrolled" }, "FoodHubTablet-test")
                    val failure = assertThrows(FoodHubApi.ApiError::class.java) { current.reportPrintListener(observation) { true } }
                    assertEquals(307, failure.status)
                    fixture.get(3, TimeUnit.SECONDS)
                    assertThrows(SocketTimeoutException::class.java) { redirect.accept().close() }
                }
            }
        } finally {
            executor.shutdownNow()
        }
    }
}
