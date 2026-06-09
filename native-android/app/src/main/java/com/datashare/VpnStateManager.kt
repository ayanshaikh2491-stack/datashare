package com.datashare

/**
 * VpnStateManager — Centralized state tracking for VPN connection
 *
 * Optimized to minimize allocations:
 * - Uses primitive types where possible
 * - No redundant string allocations
 * - Callbacks only fire on actual changes
 */
object VpnStateManager {

    // Connection states
    const val STATE_DISCONNECTED = "disconnected"
    const val STATE_CONNECTING = "connecting"
    const val STATE_CONNECTED = "connected"
    const val STATE_ERROR = "error"
    const val STATE_NOT_SUPPORTED = "not_supported"

    // Modes
    const val MODE_DONOR = "donor"
    const val MODE_RECEIVER = "receiver"

    // Volatile for thread-safe reads without locking
    @Volatile var mode: String = MODE_RECEIVER
    @Volatile var state: String = STATE_DISCONNECTED
    @Volatile var sessionId: String = ""
    @Volatile var donorId: String = ""
    @Volatile var receiverId: String = ""
    @Volatile var token: String = ""
    @Volatile var isVpnRunning: Boolean = false

    // Data tracking with atomic semantics
    @Volatile var bytesTransferred: Long = 0L
    @Volatile var connectionStartTime: Long = 0L

    // Server config
    // Server URL - deployed on Render auto-scaling
    const val SERVER_URL = "wss://datashare-server.onrender.com/ws-vpn"

    // Pre-calculated thresholds
    private val KB = 1024L
    private val MB = KB * 1024
    private val GB = MB * 1024

    // Formatting buffers (reused to avoid allocation)
    private val formatLock = Any()
    private var formatBuffer = StringBuilder(32)

    // Callbacks — single listener to avoid allocation overhead
    private var onStateChangeListener: ((String) -> Unit)? = null
    private var onDataUpdateListener: ((Long) -> Unit)? = null

    fun setOnStateChangeListener(listener: ((String) -> Unit)?) {
        onStateChangeListener = listener
    }

    fun setOnDataUpdateListener(listener: ((Long) -> Unit)?) {
        onDataUpdateListener = listener
    }

    fun updateState(newState: String) {
        if (state != newState) { // Only fire if actually changed
            state = newState
            onStateChangeListener?.invoke(newState)
        }
    }

    fun addBytes(count: Long) {
        bytesTransferred += count
        onDataUpdateListener?.invoke(bytesTransferred)
    }

    fun reset() {
        state = STATE_DISCONNECTED
        sessionId = ""
        donorId = ""
        receiverId = ""
        bytesTransferred = 0L
        connectionStartTime = 0L
        isVpnRunning = false
    }

    fun formatBytes(bytes: Long): String {
        synchronized(formatLock) {
            formatBuffer.clear()
            when {
                bytes < KB -> formatBuffer.append(bytes).append(" B")
                bytes < MB -> formatBuffer.append(bytes / KB).append(" KB")
                bytes < GB -> {
                    val mb = bytes.toDouble() / MB
                    formatBuffer.append(String.format("%.1f MB", mb))
                }
                else -> {
                    val gb = bytes.toDouble() / GB
                    formatBuffer.append(String.format("%.2f GB", gb))
                }
            }
            return formatBuffer.toString()
        }
    }
}
