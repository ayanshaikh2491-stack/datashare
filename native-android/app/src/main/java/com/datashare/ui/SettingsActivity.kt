package com.datashare.ui

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.datashare.R
import com.datashare.databinding.ActivitySettingsBinding
import com.datashare.service.DataSharePreferences

/**
 * SettingsActivity - App settings
 */
class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding
    private lateinit var prefs: DataSharePreferences

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)
        prefs = DataSharePreferences(this)

        binding.etDataLimit.setText(prefs.dataLimitMB.toString())
        binding.etServerUrl.setText(prefs.serverUrl)
        binding.switchAutoConnect.isChecked = prefs.autoConnect

        binding.btnSave.setOnClickListener {
            prefs.dataLimitMB = binding.etDataLimit.text.toString().toIntOrNull() ?: 500
            prefs.serverUrl = binding.etServerUrl.text.toString().trim()
            prefs.autoConnect = binding.switchAutoConnect.isChecked
            finish()
        }

        binding.btnCancel.setOnClickListener {
            finish()
        }
    }
}
