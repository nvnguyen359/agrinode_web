// app.js - Luồng chạy chính (Entry Point) & Logic Thiết bị
const App = {
    init: async function() {
        document.getElementById('dev-zone').innerHTML = MasterData.zones.filter(z => z.id !== 'all').map(z => `<option value="${z.id}">${z.icon} ${z.name}</option>`).join('');
        
        if (Config.isLocal) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);
                const infoRes = await fetch('/api/info', { signal: controller.signal });
                clearTimeout(timeoutId);
                const infoData = await infoRes.json();
                State.HARDWARE_PINS = infoData.hardware_pins;
                
                if (infoData.version) {
                    State.CURRENT_VERSION = infoData.version;
                    UI.updateVersionUI(State.CURRENT_VERSION);
                    if(!State.hasCheckedUpdate) { State.hasCheckedUpdate = true; setTimeout(OTA.autoCheckUpdate, 2000); }
                }
            } catch (e) { App.loadDefaultPins(); }
            await App.fetchLocalDevices(); 
        } else {
            App.loadDefaultPins();
        }

        if (State.currentPin) {
            document.getElementById('pin-lock-overlay').classList.add('hidden');
            UI.showLoading("Đang kết nối hệ thống...");
        } else {
            document.getElementById('pin-lock-overlay').classList.remove('hidden');
        }

        Network.initMQTT();
        UI.navigate('dashboard');
        
        // KHỞI CHẠY 2 VÒNG LẶP NỀN
        App.startStatusLoop();
        App.startCountdownLoop(); // Bật đồng hồ đếm ngược
    },

    loadDefaultPins: function() {
        const pins = [4, 5, 12, 13, 14, 15, 16]; 
        State.HARDWARE_PINS = pins.map(p => ({pin: p, label: 'D'+p}));
    },

    checkPin: function() {
        const inputStr = document.getElementById('secret-pin-input').value;
        if (inputStr.length < 6) return; 
        document.getElementById('pin-error-msg').style.display = 'none';

        if (Config.isLocal) {
            UI.showLoading("Đang xác thực mã PIN...");
            fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: inputStr }) })
            .then(res => res.json()).then(data => {
                if (data.success) {
                    State.currentPin = inputStr; localStorage.setItem('agrinode_pin', State.currentPin);
                    document.getElementById('pin-lock-overlay').classList.add('hidden');
                    App.fetchLocalDevices(); UI.hideLoading();
                } else {
                    UI.hideLoading(); document.getElementById('pin-error-msg').style.display = 'block'; document.getElementById('secret-pin-input').value = '';
                }
            }).catch(err => { UI.hideLoading(); UI.showAlert("Lỗi mạng", "Không thể kết nối đến ESP!", "❌"); });
            return;
        }

        if (!State.isMqttConnected || !State.mqttClient) {
            document.getElementById('pin-status-msg').style.display = 'block'; 
            State.currentPin = inputStr; State.isWaitingForConnection = true; return; 
        }
        
        document.getElementById('pin-status-msg').style.display = 'none';
        State.currentPin = inputStr; UI.showLoading("Đang xác thực mã PIN..."); 
        const message = new Paho.MQTT.Message(JSON.stringify({ cmd: "login", auth_pin: State.currentPin, client_id: Config.clientId }));
        message.destinationName = `agrinode_${Config.MAC_ADDRESS}/control`.toLowerCase();
        State.mqttClient.send(message);
    },

    fetchLocalDevices: async function() {
        if (!Config.isLocal) return;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const res = await fetch('/api/devices', { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) { 
                State.devices = await res.json(); 
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
        let inputName = document.getElementById('dev-name').value.trim();
        if (!inputName) { const pinObj = State.HARDWARE_PINS.find(p => parseInt(p.pin) === parseInt(selectedPin)); inputName = `${MasterData.deviceTypeNames[State.tempDeviceType]} (Chân ${pinObj ? pinObj.label.split(' ')[0] : selectedPin})`; }
        
        const isCycle = document.getElementById('dev-cycle-enable').checked;
        const deviceData = {
            id: State.editingDeviceId ? State.editingDeviceId : 'dev_' + Date.now(),
            type: State.tempDeviceType, name: inputName, pin: parseInt(selectedPin), zone: document.getElementById('dev-zone').value, isCycleMode: isCycle,
            cycleOn: isCycle ? parseInt(document.getElementById('dev-cycle-on').value) : 0, cycleOff: isCycle ? parseInt(document.getElementById('dev-cycle-off').value) : 0
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
            UI.showConfirm("Cảnh báo", "Bạn đang quét mạng qua Cloud. Quá trình này sẽ làm mạch tạm ngưng kết nối vài giây để quét sóng. Tiếp tục?", () => {
                Network.sendAction({ cmd: "wifi_scan" }, "Đang yêu cầu ESP quét WiFi từ xa...");
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
            : `CẢNH BÁO NGUY HIỂM!\n\nBạn đang ra lệnh đổi WiFi TỪ XA. Nếu bạn nhập sai mật khẩu, mạch ESP sẽ bị mất kết nối vĩnh viễn và bạn phải ra tận nơi để sửa!\n\nBạn có chắc chắn mạch ESP bắt được sóng của WiFi [ ${ssid} ] không?`;
            
        UI.showConfirm("Xác nhận đổi WiFi", confirmMsg, () => {
            UI.showLoading(`Đang gửi lệnh cấu hình WiFi: ${ssid}...`);

            if (Config.isLocal) {
                const handleRedirect = () => {
                    UI.hideLoading();
                    UI.showConfirm("Thành công", "Đã lưu WiFi! Mạch đang khởi động lại.\n\nBạn có muốn chuyển sang trang quản lý Cloud (GitHub Pages) không?", () => {
                        window.location.href = "https://nvnguyen359.github.io/agrinode_web/";
                    }, "✅");
                };
                fetch('/api/wifi/save', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ ssid, pass }) })
                .then(res => res.json()).then(data => handleRedirect()).catch(err => handleRedirect());
            } else {
                Network.sendAction({ cmd: "wifi_save", ssid: ssid, pass: pass }, "Đang gửi mật khẩu qua Cloud...");
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
                const res = await fetch('/api/status', { signal: controller.signal });
                clearTimeout(timeoutId);
                document.getElementById('connection-status').className = 'status-dot online';
                UI.updateTelemetryUI(await res.json());
            } catch(e) { document.getElementById('connection-status').className = State.isMqttConnected ? 'status-dot online' : 'status-dot offline'; }
            finally { State.isFetchingStatus = false; }
        }, 5000);
    },

    // ================= VÒNG LẶP XỬ LÝ ĐỒNG HỒ ĐẾM NGƯỢC =================
    startCountdownLoop: function() {
        setInterval(() => {
            if (State.devices.length === 0) return;
            
            State.devices.forEach(dev => {
                if (dev.isCycleMode && dev.timeLeft !== undefined) {
                    // Giảm dần giây
                    if (dev.timeLeft > 0) dev.timeLeft--;
                    
                    const timerEl = document.getElementById(`timer-${dev.id}`);
                    if (timerEl) {
                        if (dev.timeLeft > 0) {
                            const m = Math.floor(dev.timeLeft / 60);
                            const s = dev.timeLeft % 60;
                            timerEl.innerHTML = `⏳ Đảo trạng thái sau: ${m}p ${s}s`;
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