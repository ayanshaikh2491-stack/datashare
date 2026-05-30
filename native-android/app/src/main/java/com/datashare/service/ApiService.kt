package com.datashare.service

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * ApiService - HTTP API calls to DataShare server
 */
class ApiService {
    companion object {
        private var instance: ApiService? = null
        fun getInstance(): ApiService = instance ?: ApiService().also { instance = it }
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val baseUrl = "https://datashare-server.onrender.com/api"
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    data class LoginResponse(
        val success: Boolean,
        val userId: String = "",
        val name: String = "",
        val token: String = "",
        val role: String = "",
        val message: String = ""
    )

    fun login(email: String, name: String): LoginResponse {
        return try {
            val json = JSONObject()
            json.put("email", email)
            if (name.isNotEmpty()) json.put("name", name)

            val body = json.toString().toRequestBody(jsonType)
            val request = Request.Builder()
                .url("$baseUrl/auth/login")
                .post(body)
                .header("Content-Type", "application/json")
                .build()

            client.newCall(request).execute().use { response ->
                val respJson = JSONObject(response.body?.string() ?: "{}")
                if (response.isSuccessful) {
                    LoginResponse(
                        success = true,
                        userId = respJson.optString("user", JSONObject()).optString("id", ""),
                        name = respJson.optJSONObject("user")?.optString("name", "") ?: "",
                        token = respJson.optString("token", ""),
                        role = respJson.optJSONObject("user")?.optString("role", "receiver") ?: "receiver"
                    )
                } else {
                    LoginResponse(success = false, message = respJson.optString("error", "Login failed"))
                }
            }
        } catch (e: Exception) {
            LoginResponse(success = false, message = e.message ?: "Network error")
        }
    }

    fun getDonors(token: String): List<JSONObject> {
        return try {
            val request = Request.Builder()
                .url("$baseUrl/receiver/donors")
                .header("Authorization", "Bearer $token")
                .get()
                .build()

            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val json = JSONObject(response.body?.string() ?: "{}")
                    val donors = json.optJSONArray("donors")
                    val list = mutableListOf<JSONObject>()
                    for (i in 0 until (donors?.length() ?: 0)) {
                        list.add(donors?.getJSONObject(i) ?: JSONObject())
                    }
                    list
                } else emptyList()
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun connectToDonor(token: String, donorId: String): JSONObject {
        return try {
            val json = JSONObject()
            json.put("donor_id", donorId)
            json.put("amount_mb", 500)

            val body = json.toString().toRequestBody(jsonType)
            val request = Request.Builder()
                .url("$baseUrl/transfer/connect")
                .post(body)
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer $token")
                .build()

            client.newCall(request).execute().use { response ->
                JSONObject(response.body?.string() ?: "{}")
            }
        } catch (e: Exception) {
            JSONObject().put("error", e.message)
        }
    }

    fun updateTransfer(token: String, connectionId: String, dataMb: Double, speedMbps: Double): JSONObject {
        return try {
            val json = JSONObject()
            json.put("connection_id", connectionId)
            json.put("data_mb", dataMb)
            json.put("speed_mbps", speedMbps)
            json.put("is_transferring", true)

            val body = json.toString().toRequestBody(jsonType)
            val request = Request.Builder()
                .url("$baseUrl/transfer/update")
                .post(body)
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer $token")
                .build()

            client.newCall(request).execute().use { response ->
                JSONObject(response.body?.string() ?: "{}")
            }
        } catch (e: Exception) {
            JSONObject().put("error", e.message)
        }
    }
}
