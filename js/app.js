// app.js - Luồng chạy chính (Entry Point) & Logic Thiết bị
const App = {
    init: async function() {
        // 1. Dựng khung giao diện ngay lập tức
        document.getElementById('dev-zone').innerHTML = MasterData.zones.filter(z => z.id !== 'all').map(z => `<option value="${z.id}">${z.icon} ${z.name}</option>`).join('');
        
        // 2. Chuyển vào form đăng nhập mà không chờ fetch API
        if (State.currentPin) {
            document.getElementById('pin-lock-overlay').classList.add('hidden');
            document.getElementById('secret-pin-input').value = State.currentPin; 
            UI.showLoading("Đang kết nối hệ thống...");
            setTimeout(() => { App.checkPin(); }, 500);
        } else {
            document.getElementById('pin-lock-overlay').classList.remove('hidden');
        }

        Network.initMQTT();
        UI.navigate('dashboard');
        
        App.startStatusLoop();
        App.startCountdownLoop();

        // 3. Gọi API Local chạy ngầm phía sau (Không chặn UI)
        if (Config.isLocal) {
            App.loadLocalDataBg();
        }
    },

    loadLocalDataBg: async function() {
        try {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 3000);
            fetch('/api/info?_t=' + Date.now(), { signal: controller.signal })
            .then(res => res.json())
            .then(infoData => {
                State.HARDWARE_PINS = infoData.hardware_pins;
                if (infoData.version) {
                    State.CURRENT_VERSION = infoData.version;
                    UI.updateVersionUI(State.CURRENT_VERSION);
                    if(!State.hasCheckedUpdate) { State.hasCheckedUpdate = true; setTimeout(OTA.autoCheckUpdate, 2000); }
                }
            }).catch(e => console.warn("API /info error", e));
        } catch(e) {}

        try {
            fetch('/api/settings?_t=' + Date.now())
            .then(res => res.json())
            .then(data => State.settings = data).catch(e=>{});
        } catch(e) {}

        await App.fetchLocalDevices();
    },

    checkPin: function() {
        const inputStr = document.getElementById('secret-pin-input').value;
        if (inputStr.length < 6) return; 
        document.getElementById('pin-error-msg').style.display = 'none';

        if (Config.isLocal) {
            UI.showLoading("Đang xác thực mã PIN...");
            const controller = new AbortController();
            const timeoutId = setTimeout(() => { controller.abort(); }, 5000); // Tự hủy sau 5s

            fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: inputStr }), signal: controller.signal })
            .then(res => res.json()).then(data => {
                clearTimeout(timeoutId);
                if (data.success) {
                    State.currentPin = inputStr; localStorage.setItem('agrinode_pin', State.currentPin);
                    document.getElementById('pin-lock-overlay').classList.add('hidden');
                    App.fetchLocalDevices(); UI.hideLoading();
                } else {
                    UI.hideLoading(); document.getElementById('pin-error-msg').style.display = 'block'; document.getElementById('secret-pin-input').value = '';
                }
            }).catch(err => { 
                clearTimeout(timeoutId);
                UI.hideLoading(); 
                UI.showAlert("Lỗi mạng", "Không thể kết nối đến ESP. Vui lòng tải lại trang!", "❌"); 
                document.getElementById('pin-lock-overlay').classList.remove('hidden');
            });
            return;
        }

        // --- DÀNH CHO BẢN CLOUD ---
        if (!State.isMqttConnected || !State.mqttClient) {
            document.getElementById('pin-status-msg').style.display = 'block'; 
            State.currentPin = inputStr; State.isWaitingForConnection = true; 
            
            // Ép văng ra nếu ESP đang rớt mạng (tránh loading mãi)
            setTimeout(() => {
                UI.hideLoading();
                if(State.isWaitingForConnection) {
                    UI.showAlert("Mất kết nối", "Mạch ESP hiện đang Offline. Hãy kiểm tra điện & WiFi của mạch!", "🔌");
                    document.getElementById('pin-lock-overlay').classList.remove('hidden');
                    State.isWaitingForConnection = false;
                }
            }, 8000);
            return; 
        }
        
        document.getElementById('pin-status-msg').style.display = 'none';
        State.currentPin = inputStr; UI.showLoading("Đang xác thực qua Cloud..."); 
        const message = new Paho.MQTT.Message(JSON.stringify({ cmd: "login", auth_pin: State.currentPin, client_id: Config.clientId }));
        message.destinationName = `agrinode_${Config.MAC_ADDRESS}/control`.toLowerCase();
        State.mqttClient.send(message);

        // Fail-safe: Quá 8s mạch ESP không trả lời thì báo lỗi Offline
        setTimeout(() => {
            UI.hideLoading();
            if(document.getElementById('pin-lock-overlay').classList.contains('hidden') === false) {
                 UI.showAlert("Mất kết nối", "Mạch ESP không phản hồi xác thực. Vui lòng thử lại!", "🔌");
            }
        }, 8000);
    },

    fetchLocalDevices: async function() {
        if (!Config.isLocal) return;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const res = await fetch('/api/devices?_t=' + Date.now(), { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) { 
                const data = await res.json();
                State.devices = data.devices ? data.devices : data; 
                if(data.version) {
                    State.CURRENT_VERSION = data.version;
                    UI.updateVersionUI(State.CURRENT_VERSION);
                }
                UI.renderZones(); UI.renderDevices(); await App.checkAndRestoreBackup(); 
            }
        } catch(e) {}
    },

    checkAndRestoreBackup: async function() {
        if (State.devices.length === 0) {
            const backupStr = localStorage.getItem(Config.BACKUP_KEY);
            if (backupStr) {
                try {
                    const backedUpDevices = JSON.parse(backupStr);
                    if (backedUpDevices.length > 0) {
                        const msg = `⚠️ Mạch đang trống thiết bị (có thể do vừa cập nhật phần mềm hoặc reset).\n\nPhát hiện bản sao lưu gồm ${backedUpDevices.length} thiết bị trên trình duyệt của bạn.\n\nBạn có muốn khôi phục lại cấu hình này không?`;
                        UI.showConfirm("Khôi phục cấu hình", msg, async () => {
                            UI.showLoading("Đang khôi phục dữ liệu...");
                            for (const dev of backedUpDevices) {
                                await App.restoreSingleDevice(dev);
                                await new Promise(resolve => setTimeout(resolve, 500)); 
                            }
                            UI.hideLoading();
                            UI.showAlert("Hoàn tất", "Khôi phục thành công! Hệ thống đang tải lại.", "🎉");
                            if (Config.isLocal) await App.fetchLocalDevices();
                            else {
                                const msg = new Paho.MQTT.Message(JSON.stringify({ cmd: "get_config", auth_pin: State.currentPin, client_id: Config.clientId }));
                                msg.destinationName = `agrinode_${Config.MAC_ADDRESS}/control`.toLowerCase();
                                State.mqttClient.send(msg);
                            }
                        }, "💾");
                    }
                } catch (e) { console.error("Lỗi đọc backup", e); }
            }
        } else {
            if (State.devices && State.devices.length > 0) localStorage.setItem(Config.BACKUP_KEY, JSON.stringify(State.devices));
        }
    },

    restoreSingleDevice: async function(dev) {
        const deviceData = { id: dev.id, type: dev.type, name: dev.name, pin: dev.pin, zone: dev.zone, isCycleMode: dev.isCycleMode, cycleOn: dev.cycleOn, cycleOff: dev.cycleOff };
        if (Config.isLocal) { try { await fetch('/api/devices', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(deviceData) }); } catch(e) {}
        } else {
            deviceData.cmd = "upsert"; deviceData.auth_pin = State.currentPin;
            const msg = new Paho.MQTT.Message(JSON.stringify(deviceData));
            msg.destinationName = `agrinode_${Config.MAC_ADDRESS}/control`.toLowerCase();
            State.mqttClient.send(msg);
        }
    },

    saveDevice: async function() {
        const selectedPin = document.getElementById('dev-pin').value; 
        if (!selectedPin) return UI.showAlert("Lỗi", "Vui lòng chọn chân GPIO!", "⚠️");
        
        const pinObj = State.HARDWARE_PINS.find(p => parseInt(p.pin) === parseInt(selectedPin));
        const shortPinLabel = pinObj ? pinObj.label.split(' ')[0] : `GPIO ${selectedPin}`;
        const generatedName = `${MasterData.deviceTypeNames[State.tempDeviceType]} (${shortPinLabel})`;
        
        const isCycle = document.getElementById('dev-cycle-enable').checked;
        const deviceData = {
            id: State.editingDeviceId ? State.editingDeviceId : 'dev_' + Date.now(),
            type: State.tempDeviceType, 
            name: generatedName, 
            pin: parseInt(selectedPin), 
            zone: document.getElementById('dev-zone').value, 
            isCycleMode: isCycle,
            cycleOn: isCycle ? parseInt(document.getElementById('dev-cycle-on').value) : 0, 
            cycleOff: isCycle ? parseInt(document.getElementById('dev-cycle-off').value) : 0
        };

        if (!Config.isLocal) {
            deviceData.cmd = "upsert"; Network.sendAction(deviceData, "Đang đẩy cấu hình...", () => { UI.closeModal('modal-config-device'); }); return;
        }
        UI.showLoading("Đang đẩy cấu hình...");
        try {
            const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 5000);
            const res = await fetch('/api/devices', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(deviceData), signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) { await App.fetchLocalDevices(); UI.closeModal('modal-config-device'); }
        } catch(e) {}
        UI.hideLoading();
    },

    deleteDevicePrompt: function(id) {
        UI.showConfirm("Xóa thiết bị", "Bạn có chắc chắn muốn xóa thiết bị này khỏi phần cứng (ESP)?", async () => {
            if (!Config.isLocal) {
                Network.sendAction({ cmd: "delete", id: id }, "Đang xóa...", () => { 
                    State.devices = State.devices.filter(d => d.id !== id);
                    if (State.devices.length === 0) localStorage.removeItem(Config.BACKUP_KEY);
                }); return;
            }
            UI.showLoading("Đang xóa...");
            try {
                const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 5000);
                const res = await fetch(`/api/devices?id=${id}`, { method: 'DELETE', signal: controller.signal });
                clearTimeout(timeoutId);
                if (res.ok) {
                    State.devices = State.devices.filter(d => d.id !== id);
                    if (State.devices.length === 0) localStorage.removeItem(Config.BACKUP_KEY);
                    await App.fetchLocalDevices();
                }
            } catch(e) { }
            UI.hideLoading();
        }, "⚠️", true);
    },

    saveSettings: async function(silent = false) {
        if (!Config.isLocal) {
            let msg = JSON.parse(JSON.stringify(State.settings));
            msg.cmd = "save_settings";
            Network.sendAction(msg, silent ? null : "Đang lưu cấu hình...", () => { UI.renderDevices(); }); 
            return;
        }

        if(!silent) UI.showLoading("Đang lưu...");
        try {
            const res = await fetch('/api/settings', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(State.settings) });
            if (res.ok) {
                UI.renderDevices();
            } else {
                if(!silent) UI.showAlert("Lỗi", "Không thể lưu cài đặt luân phiên", "❌");
            }
        } catch(e) {
            if(!silent) UI.showAlert("Lỗi", "Lỗi kết nối", "❌");
        }
        if(!silent) UI.hideLoading();
    },

    toggleZoneCycle: function(zoneId, isEnabled, timeVal) {
        if (!State.settings.zoneCycles) State.settings.zoneCycles = [];
        let zc = State.settings.zoneCycles.find(x => x.zone === zoneId);
        if (!zc) {
            zc = { zone: zoneId, enabled: isEnabled, cycleTime: parseInt(timeVal) || 5 };
            State.settings.zoneCycles.push(zc);
        } else {
            zc.enabled = isEnabled;
            if (timeVal) zc.cycleTime = parseInt(timeVal);
        }
        
        State.devices.filter(d => d.zone === zoneId).forEach(d => d.timeLeft = undefined);
        App.saveSettings(true); 
    },
    
    toggleAllZoneCycles: function(isEnabled) {
        if (!State.settings.zoneCycles) State.settings.zoneCycles = [];
        MasterData.zones.filter(z => z.id !== 'all').forEach(z => {
            let zc = State.settings.zoneCycles.find(x => x.zone === z.id);
            if (!zc) {
                State.settings.zoneCycles.push({ zone: z.id, enabled: isEnabled, cycleTime: 5 });
            } else {
                zc.enabled = isEnabled;
            }
        });
        
        State.devices.forEach(d => d.timeLeft = undefined);
        App.saveSettings(true); 
    },

    toggleRelay: async function(id, isChecked) {
        const d = State.devices.find(x => x.id === id); if(!d) return;
        d.state = isChecked ? 'ON' : 'OFF'; UI.renderDevices(); 
        if (Config.isLocal) {
            try {
                const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 2000);
                const res = await fetch('/api/control', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ id: d.id, state: d.state }), signal: controller.signal });
                clearTimeout(timeoutId); if((await res.json()).success) return; 
            } catch(e) {}
        }
        Network.sendAction({ id: d.id, state: d.state }, null, null); 
    },

    scanWiFi: async function() {
        UI.showLoading("Đang ra lệnh quét mạng WiFi...");
        if (Config.isLocal) {
            try {
                const res = await fetch('/api/wifi/scan');
                const networks = await res.json();
                UI.populateWiFiList(networks);
            } catch (e) {
                UI.hideLoading(); UI.showAlert("Lỗi", "Không thể quét được mạng từ mạch!", "❌");
            }
        } else {
            UI.showConfirm("Cảnh báo", "Bạn đang quét mạng qua Cloud. Quá trình này làm mạch tạm ngưng kết nối vài giây để quét sóng. Tiếp tục?", () => {
                Network.sendAction({ cmd: "wifi_scan" }, "Đang yêu cầu ESP quét WiFi...");
            }, "📡");
        }
    },

    saveWiFi: function(e) {
        e.preventDefault();
        const ssid = document.getElementById('wifi-ssid').value; 
        const pass = document.getElementById('wifi-pass').value;
        if(!ssid) return UI.showAlert("Lỗi", "Vui lòng chọn WiFi!", "⚠️");
        
        const confirmMsg = Config.isLocal 
            ? `Cấu hình mạch kết nối vào WiFi: ${ssid}?` 
            : `CẢNH BÁO NGUY HIỂM!\n\nNếu bạn nhập sai mật khẩu, mạch ESP sẽ bị mất kết nối vĩnh viễn và phải ra tận nơi cài lại!\n\nBạn chắc chắn mạch ESP bắt được WiFi [ ${ssid} ] chứ?`;
            
        UI.showConfirm("Xác nhận đổi WiFi", confirmMsg, () => {
            UI.showLoading(`Đang gửi lệnh WiFi: ${ssid}...`);

            if (Config.isLocal) {
                const handleRedirect = () => {
                    UI.hideLoading();
                    UI.showConfirm("Thành công", "Đã lưu WiFi! Mạch đang khởi động lại.\n\nChuyển sang trang quản lý Cloud?", () => {
                        window.location.href = "https://nvnguyen359.github.io/agrinode_web/";
                    }, "✅");
                };
                fetch('/api/wifi/save', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ ssid, pass }) })
                .then(res => res.json()).then(data => handleRedirect()).catch(err => handleRedirect());
            } else {
                Network.sendAction({ cmd: "wifi_save", ssid: ssid, pass: pass }, "Đang gửi cấu hình mạng...");
            }
        }, "⚠️", !Config.isLocal);
    },

    startStatusLoop: function() {
        setInterval(async () => {
            if(!document.getElementById('view-dashboard').classList.contains('active') || State.isFetchingStatus) return;
            if (!Config.isLocal) { document.getElementById('connection-status').className = State.isMqttConnected ? 'status-dot online' : 'status-dot offline'; return; }
            State.isFetchingStatus = true; 
            try {
                const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 4000);
                const res = await fetch('/api/status?_t=' + Date.now(), { signal: controller.signal });
                clearTimeout(timeoutId);
                document.getElementById('connection-status').className = 'status-dot online';
                UI.updateTelemetryUI(await res.json());
            } catch(e) { document.getElementById('connection-status').className = State.isMqttConnected ? 'status-dot online' : 'status-dot offline'; }
            finally { State.isFetchingStatus = false; }
        }, 5000);
    },

    startCountdownLoop: function() {
        setInterval(() => {
            if (State.devices.length === 0) return;
            
            State.devices.forEach(dev => {
                if (dev.timeLeft !== undefined) {
                    if (dev.timeLeft > 0) dev.timeLeft--;
                    
                    const timerEl = document.getElementById(`timer-${dev.id}`);
                    if (timerEl) {
                        if (dev.timeLeft > 0) {
                            const m = Math.floor(dev.timeLeft / 60);
                            const s = dev.timeLeft % 60;
                            timerEl.innerHTML = `⏳ Đảo trạng thái sau: <strong style="color: #ef4444; margin-left: 5px;">${m}p ${s}s</strong>`;
                        } else {
                            timerEl.innerHTML = `🔄 Đang chuyển đổi...`;
                        }
                    }
                }
            });
        }, 1000);
    }
};

window.onload = App.init;