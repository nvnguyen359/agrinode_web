// controllers.js - Business Logic (Controllers)

class AuthController {
    constructor() {
        Events.on('mqttConnected', () => this.handleMqttConnected());
        Events.on('mqttConfigReceived', (data) => this.processAuthResponse(data));
    }

    handleMqttConnected() {
        if (Store.get('isWaitingForConnection') && Store.get('currentPin')) {
            Store.set('isWaitingForConnection', false);
            this.checkPin(Store.get('currentPin')); 
        } else if (Store.get('currentPin') && !Store.get('isWaitingForConnection') && !Config.isLocal) {
            Events.emit('ui:showLoading', "Đang đồng bộ dữ liệu...");
            Network.sendAction({ cmd: "get_config", client_id: Config.clientId });
        }
    }

    checkPin(inputStr) {
        if (inputStr.length < 6) return; 
        Events.emit('ui:hideAuthError');

        if (Config.isLocal) {
            Events.emit('ui:showLoading', "Đang xác thực mã PIN...");
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: inputStr }), signal: controller.signal })
            .then(res => res.json()).then(data => {
                clearTimeout(timeoutId);
                if (data.success) {
                    Store.set('currentPin', inputStr); 
                    localStorage.setItem('agrinode_pin', inputStr);
                    Events.emit('ui:hidePinLock');
                    App.DeviceCtrl.fetchLocalDevices(); 
                    Events.emit('ui:hideLoading');
                } else {
                    Events.emit('ui:hideLoading'); 
                    Events.emit('ui:showAuthError');
                }
            }).catch(err => { 
                clearTimeout(timeoutId); Events.emit('ui:hideLoading'); 
                Events.emit('ui:showAlert', { title: "Lỗi mạng", message: "Không thể kết nối đến mạch ESP. Vui lòng thử lại hoặc tải lại trang!", icon: "❌" }); 
                Events.emit('ui:showPinLock');
            });
            return;
        }

        if (!Store.get('isMqttConnected')) {
            Events.emit('ui:showAuthStatus', "Đang kết nối Cloud, vui lòng chờ...");
            Store.set('currentPin', inputStr); Store.set('isWaitingForConnection', true);
            setTimeout(() => {
                Events.emit('ui:hideLoading');
                if(Store.get('isWaitingForConnection')) {
                    Events.emit('ui:showAlert', { title: "Mất kết nối", message: "Mạch ESP hiện đang Offline. Hãy kiểm tra lại nguồn điện & WiFi của mạch!", icon: "❌" });
                    Events.emit('ui:showPinLock');
                    Store.set('isWaitingForConnection', false);
                }
            }, 8000);
            return; 
        }
        
        Events.emit('ui:hideAuthStatus');
        Store.set('currentPin', inputStr); 
        Events.emit('ui:showLoading', "Đang xác thực trực tiếp qua Cloud..."); 
        Network.sendAction({ cmd: "login", client_id: Config.clientId });
        
        setTimeout(() => {
            Events.emit('ui:hideLoading');
            Events.emit('ui:checkAuthTimeout'); 
        }, 8000);
    }

    processAuthResponse(data) {
        if (!data.auth) return;
        if (data.client_id && data.client_id !== Config.clientId) return;
        if (data.auth === "ok") {
            localStorage.setItem('agrinode_pin', Store.get('currentPin')); 
            Events.emit('ui:hidePinLock');
            if (!Config.isLocal) {
                Events.emit('ui:showLoading', "Đang tải dữ liệu thiết bị...");
                Network.sendAction({ cmd: "get_config", client_id: Config.clientId });
            } else { Events.emit('ui:hideLoading'); }
        } else {
            Events.emit('ui:hideLoading');
            Events.emit('ui:showAuthError');
            Store.set('currentPin', ""); 
            localStorage.removeItem('agrinode_pin');
            Events.emit('ui:showPinLock');
        }
    }
}

class DeviceController {
    constructor() {
        Events.on('mqttConfigReceived', (data) => {
            // TÍNH NĂNG MỚI: Bắt sự kiện Cloud trả về danh sách Rơ-le quét được
            if (data.cmd_response === "espnow_scan") {
                Events.emit('ui:scanEspNowState', 'done');
                Events.emit('ui:renderEspNowResults', data.devices || []);
                return; // Dừng tại đây, không cho chạy tiếp xuống logic xử lý DeviceConfig
            }
            this.handleDeviceConfig(data);
        });
        
        Events.on('mqttTelemetryReceived', (data) => this.handleTelemetry(data));
    }

    async fetchLocalDevices() {
        if (!Config.isLocal) return;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const res = await fetch('/api/devices?_t=' + Date.now(), { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) { 
                const data = await res.json();
                Store.set('devices', data.devices ? data.devices : data); 
                if(data.version) Store.set('CURRENT_VERSION', data.version);
                this.checkAndRestoreBackup(); 
            }
        } catch(e) {}
    }

    handleDeviceConfig(data) {
        let dataHasUpdated = false;
        if (data.hardware_pins) { Store.set('HARDWARE_PINS', data.hardware_pins.map(p => typeof p === 'object' ? p : {pin: p, label: 'D'+p})); dataHasUpdated = true; }
        if (data.devices || Array.isArray(data)) { Store.set('devices', data.devices || data); dataHasUpdated = true; this.checkAndRestoreBackup(); } 
        if (data.settings) { Store.set('settings', data.settings); dataHasUpdated = true; }
        
        if (dataHasUpdated) Events.emit('ui:hideLoading');
    }

    handleTelemetry(data) {
        let changed = false;
        const devices = Store.get('devices');
        if (data.devices) { 
             data.devices.forEach(r => { 
                 const dev = devices.find(d => d.id === r.id); 
                 if(dev) {
                    if (dev.state !== r.state) { dev.state = r.state; changed = true; }
                    if (r.timeLeft !== undefined) dev.timeLeft = r.timeLeft;
                } 
             }); 
         }
        if(changed) Store.set('devices', devices); 
    }

    async saveDevice(deviceData) {
        if (!Config.isLocal) {
            deviceData.cmd = "upsert"; 
            Network.sendAction(deviceData, "Đang đẩy cấu hình lên hệ thống...", () => Events.emit('ui:closeModal', 'modal-config-device')); 
            return;
        }
        Events.emit('ui:showLoading', "Đang đẩy cấu hình lên hệ thống...");
        try {
            const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 5000);
            const res = await fetch('/api/devices', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(deviceData), signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) { await this.fetchLocalDevices(); Events.emit('ui:closeModal', 'modal-config-device'); }
        } catch(e) {}
        Events.emit('ui:hideLoading');
    }

    deleteDevicePrompt(id) {
        Events.emit('ui:showConfirm', {
            title: "Xóa thiết bị", msg: "Bạn có chắc chắn muốn xóa thiết bị này khỏi hệ thống (ESP)?", icon: "🗑️", isDanger: true,
            onConfirm: async () => {
                if (!Config.isLocal) {
                    Network.sendAction({ cmd: "delete", id: id }, "Đang xóa...", () => { 
                        Store.removeDevice(id);
                        if (Store.get('devices').length === 0) localStorage.removeItem(Config.BACKUP_KEY);
                    }); return;
                }
                Events.emit('ui:showLoading', "Đang xóa...");
                try {
                    const res = await fetch(`/api/devices?id=${id}`, { method: 'DELETE' });
                    if (res.ok) {
                        Store.removeDevice(id);
                        if (Store.get('devices').length === 0) localStorage.removeItem(Config.BACKUP_KEY);
                        await this.fetchLocalDevices();
                    }
                } catch(e) {}
                Events.emit('ui:hideLoading');
            }
        });
    }

    async toggleRelay(id, isChecked) {
        const devices = Store.get('devices');
        const d = devices.find(x => x.id === id); if(!d) return;
        d.state = isChecked ? 'ON' : 'OFF'; 
        Store.set('devices', devices);
        
        if (Config.isLocal) {
            try { fetch('/api/control', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ id: d.id, state: d.state }) }); } catch(e) {}
        } else {
            Network.sendAction({ id: d.id, state: d.state }, null, null); 
        }
    }

    // TÍNH NĂNG MỚI: QUÉT ESP-NOW KẾT HỢP CLOUD VÀ LOCAL
    async scanEspNow() {
        Events.emit('ui:openModal', 'modal-scan-espnow');
        Events.emit('ui:scanEspNowState', 'scanning');

        if (Config.isLocal) {
            try {
                const res = await fetch('/api/espnow/scan');
                const data = await res.json();
                Events.emit('ui:scanEspNowState', 'done');
                Events.emit('ui:renderEspNowResults', data.devices);
            } catch (e) {
                Events.emit('ui:closeModal', 'modal-scan-espnow');
                Events.emit('ui:showAlert', { title: "Lỗi", message: "Không thể gọi lệnh quét từ mạch!", icon: "❌" });
            }
        } else {
            // Quét qua MQTT (Giao diện sẽ tiếp tục xoay Radar cho đến khi bắt được sự kiện mqttConfigReceived)
            Events.emit('ui:showConfirm', {
                title: "Dò Radar qua Cloud", 
                msg: "Lệnh dò Rơ-le sẽ được gửi qua Internet.\nMạch Master cần khoảng 3 giây để thu thập tín hiệu.\n\nTiếp tục?", 
                icon: "☁️",
                onConfirm: () => {
                    Network.sendAction({ cmd: "espnow_scan" });
                },
                onCancel: () => Events.emit('ui:closeModal', 'modal-scan-espnow')
            });
        }
    }

    async checkAndRestoreBackup() {
        const devices = Store.get('devices');
        if (devices.length === 0) {
            const backupStr = localStorage.getItem(Config.BACKUP_KEY);
            if (backupStr) {
                try {
                    const backedUpDevices = JSON.parse(backupStr);
                    if (backedUpDevices.length > 0) {
                        Events.emit('ui:showConfirm', {
                            title: "Khôi phục cấu hình", 
                            msg: `Phát hiện bản sao lưu gồm ${backedUpDevices.length} thiết bị. Khôi phục lại?`, 
                            icon: "💾", isDanger: false,
                            onConfirm: async () => {
                                Events.emit('ui:showLoading', "Đang khôi phục dữ liệu...");
                                for (const dev of backedUpDevices) {
                                    await this.restoreSingleDevice(dev);
                                    await new Promise(resolve => setTimeout(resolve, 500)); 
                                }
                                Events.emit('ui:hideLoading');
                                Events.emit('ui:showAlert', { title: "Hoàn tất", message: "Khôi phục thành công! Hệ thống đang tải lại.", icon: "✅" });
                                if (Config.isLocal) await this.fetchLocalDevices();
                                else Network.sendAction({ cmd: "get_config", client_id: Config.clientId });
                            }
                        });
                    }
                } catch (e) { console.error("Lỗi đọc backup", e); }
            }
        } else {
            localStorage.setItem(Config.BACKUP_KEY, JSON.stringify(devices));
        }
    }
    
    async restoreSingleDevice(dev) {
        const deviceData = { id: dev.id, type: dev.type, name: dev.name, connectionType: dev.connectionType || 'wired', pin: dev.pin, macAddress: dev.macAddress || "", zone: dev.zone, isCycleMode: dev.isCycleMode, cycleOn: dev.cycleOn, cycleOff: dev.cycleOff };
        if (Config.isLocal) { try { await fetch('/api/devices', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(deviceData) }); } catch(e) {}
        } else {
            deviceData.cmd = "upsert"; 
            Network.sendAction(deviceData);
        }
    }
}

class SystemController {
    constructor() {
        Events.on('mqttConfigReceived', (data) => {
            if (data.cmd_response === "wifi_scan") Events.emit('ui:populateWiFiList', data.networks || []);
            if (data.cmd_response === "wifi_save") this.handleWifiSaveResponse(data);
            if (data.version) this.handleVersionReport(data.version);
        });
        Events.on('mqttTelemetryReceived', (data) => {
            if (data.ota_progress !== undefined) Events.emit('ui:showOtaProgress', data.ota_progress);
            if (data.ota_error !== undefined) Events.emit('ui:cancelOtaProgress', "Lỗi cập nhật từ mạch: " + data.ota_error);
        });
    }

    isNewerVersion(current, latest) {
        if (!current || !latest || current === "Unknown") return false;
        const c = current.split('.').map(Number), l = latest.split('.').map(Number);
        for (let i = 0; i < Math.max(c.length, l.length); i++) {
            if ((l[i] || 0) > (c[i] || 0)) return true;
            if ((l[i] || 0) < (c[i] || 0)) return false;
        }
        return false;
    }

    handleVersionReport(version) {
        Store.set('CURRENT_VERSION', version);
        if (!Store.get('hasCheckedUpdate') && !Config.isLocal) { 
            Store.set('hasCheckedUpdate', true); 
            setTimeout(() => this.autoCheckUpdate(), 2000); 
        }
    }

    async autoCheckUpdate() {
        if (Store.get('CURRENT_VERSION') === "Unknown") return;
        try {
            const res = await fetch(Config.GITHUB_VERSION_URL + "?t=" + new Date().getTime(), { cache: "no-store" });
            const vData = await res.json();
            if (vData.version && this.isNewerVersion(Store.get('CURRENT_VERSION'), vData.version)) {
                Events.emit('ui:updateVersionBadge', vData.version);
                Events.emit('ui:showConfirm', {
                    title: "Cập nhật phần mềm", msg: `Phát hiện phiên bản mới: v${vData.version}\n\n[Tính năng mới]\n${vData.release_notes || 'Bản vá lỗi'}\n\nCập nhật ngay?`, icon: "🚀",
                    onConfirm: () => this.executeOtaUpdate(vData.firmware_url)
                });
            }
        } catch (e) {}
    }

    async promptUpdate(forceCheck = false) {
        if (forceCheck) Events.emit('ui:showLoading', "Đang kiểm tra phiên bản...");
        try {
            const res = await fetch(Config.GITHUB_VERSION_URL + "?t=" + new Date().getTime(), { cache: "no-store" });
            const vData = await res.json();
            if (forceCheck) Events.emit('ui:hideLoading');

            if (!vData.version || !vData.firmware_url) return Events.emit('ui:showAlert', {title:"Lỗi", message:"File JSON không hợp lệ.", icon:"❌"});
            if (!this.isNewerVersion(Store.get('CURRENT_VERSION'), vData.version)) {
                return Events.emit('ui:showAlert', {title:"Thông báo", message:`Thiết bị ở phiên bản mới nhất (v${Store.get('CURRENT_VERSION')}).`, icon:"✅"});
            }

            Events.emit('ui:updateVersionBadge', vData.version);
            Events.emit('ui:showConfirm', {
                title: "Cập nhật phần mềm", msg: `Phát hiện phiên bản mới: v${vData.version}\n\nBạn có muốn cập nhật thiết bị ngay bây giờ không?`, icon: "🚀",
                onConfirm: () => this.executeOtaUpdate(vData.firmware_url)
            });
        } catch (e) {
            if (forceCheck) Events.emit('ui:hideLoading');
            Events.emit('ui:showAlert', {title:"Lỗi mạng", message:"Không thể lấy thông tin phiên bản!", icon:"🌐"});
        }
    }

    async executeOtaUpdate(targetFirmwareUrl) {
        Events.emit('ui:startFakeOtaProgress'); 
        if (Config.isLocal) {
            try {
                const res = await fetch('/api/ota/cloud', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ url: targetFirmwareUrl }) });
                if (!(await res.json()).success) Events.emit('ui:cancelOtaProgress', "Mạch từ chối lệnh nạp!");
            } catch(e) {}
        } else {
            Network.sendAction({ cmd: "update", url: targetFirmwareUrl }, null, () => Events.emit('ui:updateVersionBadge', null));
        }
    }

    async scanWiFi() {
        Events.emit('ui:showLoading', "Đang ra lệnh mạch quét mạng WiFi...");
        if (Config.isLocal) {
            try { Events.emit('ui:populateWiFiList', await (await fetch('/api/wifi/scan')).json()); } 
            catch (e) { Events.emit('ui:hideLoading'); Events.emit('ui:showAlert', {title:"Lỗi", message:"Không thể tải danh sách WiFi!", icon:"❌"}); }
        } else {
            Events.emit('ui:showConfirm', {
                title: "Cảnh báo tốc độ", msg: "Quét qua Cloud sẽ mất thời gian và có thể mất kết nối tạm thời. Tiếp tục?", icon: "⚠️",
                onConfirm: () => Network.sendAction({ cmd: "wifi_scan" }, "Đang yêu cầu ESP quét WiFi...")
            });
        }
    }

    saveWiFi(ssid, pass) {
        const confirmMsg = Config.isLocal ? `Xác nhận cho mạch kết nối WiFi: ${ssid}?` : `CẢNH BÁO NGUY HIỂM!\nSai mật khẩu ESP sẽ mất kết nối. Đổi sang [ ${ssid} ]?`;
        Events.emit('ui:showConfirm', {
            title: "Xác nhận đổi mạng", msg: confirmMsg, icon: "🌐", isDanger: !Config.isLocal,
            onConfirm: () => {
                Events.emit('ui:showLoading', `Đang gửi lệnh đổi WiFi: ${ssid}...`);
                if (Config.isLocal) {
                    fetch('/api/wifi/save', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ ssid, pass }) })
                    .finally(() => {
                        Events.emit('ui:hideLoading');
                        Events.emit('ui:showConfirm', { title: "Hoàn tất", msg: "Đã lưu! Bạn muốn chuyển sang trang Cloud không?", icon: "🔄", onConfirm: () => window.location.href = "https://nvnguyen359.github.io/agrinode_web/" });
                    });
                } else {
                    Network.sendAction({ cmd: "wifi_save", ssid: ssid, pass: pass }, "Đang gửi lệnh đổi mạng...");
                }
            }
        });
    }

    handleWifiSaveResponse(data) {
        Events.emit('ui:hideLoading');
        if (data.success) Events.emit('ui:showAlert', {title:"Thành công", message:"Cấu hình WiFi thành công! Mạch đang khởi động lại.", icon:"✅"});
        else Events.emit('ui:showAlert', {title:"Thất bại", message:"Không thể kết nối WiFi này. Mạch sẽ quay lại cấu hình cũ.", icon:"❌"});
    }
}