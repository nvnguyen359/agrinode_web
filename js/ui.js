// ui.js - Lớp View (DOM Manipulation & Render)
class UIManager {
    constructor() {
        this.bindGlobalEvents();
    }

    bindGlobalEvents() {
        Events.on('stateChange:devices', () => { this.renderZones(); this.renderDevices(); });
        Events.on('stateChange:activeZone', () => { this.renderZones(); this.renderDevices(); });
        Events.on('stateChange:CURRENT_VERSION', (v) => this.updateVersionUI(v));
        Events.on('networkStatus', (status) => {
            document.getElementById('connection-status').className = 'status-dot ' + status;
            if(status === 'offline') this.showOfflineOverlay(); else this.hideOfflineOverlay();
        });
        Events.on('mqttTelemetryReceived', (data) => this.updateTelemetryUI(data));
        
        // UI Action listeners
        Events.on('ui:showLoading', (msg) => this.showLoading(msg));
        Events.on('ui:hideLoading', () => this.hideLoading());
        Events.on('ui:showAlert', (data) => this.showAlert(data.title, data.message, data.icon));
        Events.on('ui:showConfirm', (data) => this.showConfirm(data.title, data.msg, data.onConfirm, data.icon, data.isDanger));
        Events.on('ui:openModal', (id) => this.openModal(id));
        Events.on('ui:closeModal', (id) => this.closeModal(id));
        Events.on('ui:hidePinLock', () => { document.getElementById('pin-lock-overlay').classList.add('hidden'); document.getElementById('pin-error-msg').style.display = 'none'; });
        Events.on('ui:showPinLock', () => document.getElementById('pin-lock-overlay').classList.remove('hidden'));
        Events.on('ui:showAuthError', () => { document.getElementById('pin-error-msg').style.display = 'block'; document.getElementById('secret-pin-input').value = ''; document.getElementById('pin-status-msg').style.display = 'none'; });
        Events.on('ui:hideAuthError', () => document.getElementById('pin-error-msg').style.display = 'none');
        Events.on('ui:showAuthStatus', (msg) => { document.getElementById('pin-status-msg').innerHTML = msg; document.getElementById('pin-status-msg').style.display = 'block'; });
        Events.on('ui:hideAuthStatus', () => document.getElementById('pin-status-msg').style.display = 'none');
        Events.on('ui:checkAuthTimeout', () => { if(!document.getElementById('pin-lock-overlay').classList.contains('hidden')) this.showAlert("Mất kết nối", "Mạch ESP không phản hồi xác thực. Vui lòng thử lại!", "❌"); });
        
        Events.on('ui:scanEspNowState', (state) => {
            document.getElementById('scan-radar').style.display = state === 'scanning' ? 'flex' : 'none';
            if (state === 'scanning') document.getElementById('scan-results').classList.add('hidden');
            else document.getElementById('scan-results').classList.remove('hidden');
        });
        Events.on('ui:renderEspNowResults', (devices) => this.renderEspNowResults(devices));
        Events.on('ui:populateWiFiList', (nets) => this.populateWiFiList(nets));
        Events.on('ui:updateVersionBadge', (newVer) => { this.updateVersionUI(Store.get('CURRENT_VERSION'), newVer); this.toggleOtaBadge(!!newVer); });
        Events.on('ui:startFakeOtaProgress', () => this.startFakeOtaProgress());
        Events.on('ui:showOtaProgress', (p) => this.showOtaProgress(p));
        Events.on('ui:cancelOtaProgress', (err) => this.cancelOtaProgress(err));
    }

    // Các hàm DOM giữ nguyên Logic cũ
    showLoading(txt) {
        const l = document.getElementById('loading');
        if(l) { document.getElementById('loading-text').innerText = txt; l.classList.remove('hidden'); }
    }
    hideLoading() { const l = document.getElementById('loading'); if(l) l.classList.add('hidden'); }
    showOfflineOverlay() { document.getElementById('offline-overlay').classList.remove('hidden'); }
    hideOfflineOverlay() { document.getElementById('offline-overlay').classList.add('hidden'); }
    navigate(id) {
        document.querySelectorAll('.page, .nav-item').forEach(e => e.classList.remove('active'));
        document.getElementById('view-' + id).classList.add('active');
        document.getElementById('nav-' + id).classList.add('active');
    }
    showAlert(title, message, icon = '⚠️') {
        document.getElementById('alert-title').innerText = title; document.getElementById('alert-message').innerText = message;
        document.getElementById('alert-icon').innerText = icon; document.getElementById('modal-alert').classList.remove('hidden');
    }
    closeAlert() { document.getElementById('modal-alert').classList.add('hidden'); }
    showConfirm(title, message, onConfirm, icon = '❓', isDanger = false) {
        document.getElementById('confirm-title').innerText = title; document.getElementById('confirm-message').innerText = message;
        document.getElementById('confirm-icon').innerText = icon;
        const btnOk = document.getElementById('btn-confirm-ok');
        btnOk.style.background = isDanger ? '#ef4444' : '#3b82f6';
        const newBtn = btnOk.cloneNode(true); btnOk.parentNode.replaceChild(newBtn, btnOk);
        newBtn.addEventListener('click', () => { this.closeConfirm(); if(onConfirm) onConfirm(); });
        document.getElementById('modal-confirm').classList.remove('hidden');
    }
    closeConfirm() { document.getElementById('modal-confirm').classList.add('hidden'); }
    openModal(id) { document.getElementById(id).classList.remove('hidden'); }
    closeModal(id) { document.getElementById(id).classList.add('hidden'); }

    // RENDER FUNCTIONS
    renderZones() {
        const container = document.getElementById('zone-container');
        const activeZone = Store.get('activeZone');
        const usedZoneIds = new Set(Store.get('devices').map(d => d.zone));
        const visibleZones = MasterData.zones.filter(z => z.id === 'all' || usedZoneIds.has(z.id));

        if (visibleZones.length <= 1) {
            container.style.display = 'none';
            if(activeZone !== 'all') Store.set('activeZone', 'all');
        } else {
            container.style.display = 'flex';
            container.innerHTML = visibleZones.map(z => `<button class="chip ${activeZone === z.id ? 'active' : ''}" onclick="App.UI.selectZone('${z.id}')">${z.icon} ${z.name}</button>`).join('');
        }
    }
    selectZone(id) {
         Store.set('activeZone', id);
         const z = MasterData.zones.find(x => x.id === id);
         document.getElementById('sensor-title').innerText = id === 'all' ? 'Cảm biến: Tất cả khu vực' : `Cảm biến: ${z.icon} ${z.name}`;
    }

    renderDevices() {
        const container = document.getElementById('device-list');
        const devices = Store.get('devices');
        if (devices.length === 0) return container.innerHTML = '<div class="empty-state">Chưa có thiết bị nào. Hãy thêm mới!</div>';
        
        let html = '';
        const activeZone = Store.get('activeZone');
        const zonesToRender = activeZone === 'all' ? MasterData.zones.filter(z => z.id !== 'all') : [MasterData.zones.find(z => z.id === activeZone)];
        
        zonesToRender.forEach(z => {
            const devsInZone = devices.filter(d => d.zone === z.id);
            if (devsInZone.length > 0) {
                html += `<div class="zone-card">
                            <div class="zone-group-title">${z.icon} Khu vực: ${z.name}</div>`;
                devsInZone.forEach(dev => html += this.createDeviceCard(dev));
                html += `</div>`;
            }
        });
        container.innerHTML = html || '<div class="empty-state">Khu vực này trống.</div>';
    }

    createDeviceCard(dev) {
        const isOn = dev.state === 'ON';
        const hardwarePins = Store.get('HARDWARE_PINS');
        const pinObj = hardwarePins.find(p => parseInt(p.pin) === parseInt(dev.pin));
        const shortPinLabel = (dev.connectionType === 'espnow') ? 'ESP-NOW' : (pinObj ? pinObj.label.split(' ')[0] : `GPIO ${dev.pin}`);
        
        let timerHtml = dev.timeLeft !== undefined ? `<div id="timer-${dev.id}" style="color: var(--text-main); margin-top: 6px; font-size: 0.85rem;">Đảo trạng thái sau: <strong style="color:red">${Math.floor(dev.timeLeft/60)}p ${dev.timeLeft%60}s</strong></div>` : '';
        
        return `
        <div class="control-card" style="flex-direction: column; align-items: stretch; gap: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div class="control-info" style="align-items: flex-start;">
                    <div class="device-icon ${isOn ? `bg-${dev.type}-on` : ''}" style="margin-top: 2px;">${MasterData.svgs[dev.type].replace('{ON_CLASS}', isOn ? 'on' : '')}</div>
                    <div>
                        <div class="control-name">${dev.name}</div>
                        <div class="control-state">${isOn ? 'Đang chạy' : 'Đang tắt'} (${shortPinLabel})</div>
                        ${timerHtml}
                    </div>
                </div>
                <label class="toggle-switch" style="margin-top: 5px;">
                    <input type="checkbox" ${isOn ? 'checked' : ''} onchange="App.DeviceCtrl.toggleRelay('${dev.id}', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
            <div class="device-actions">
                <button class="btn-text btn-edit" onclick="App.UI.editDevice('${dev.id}')">✏️ Sửa</button>
                <button class="btn-text btn-delete" onclick="App.DeviceCtrl.deleteDevicePrompt('${dev.id}')">🗑️ Xóa</button>
            </div>
        </div>`;
    }

    updateTelemetryUI(data) {
        if(data.temp !== undefined) document.getElementById('val-temp').innerText = data.temp;
        if(data.hum !== undefined) document.getElementById('val-hum').innerText = data.hum;
    }

    updateVersionUI(currentVer, newVer = null) {
        const headerVer = document.getElementById('header-version');
        if (headerVer) headerVer.innerText = (currentVer && currentVer !== "Unknown") ? `v${currentVer}` : 'Đang tải...';
        const setupVer = document.getElementById('current-version-text');
        if (!setupVer) return;
        if (newVer && newVer !== currentVer && currentVer !== "Unknown") setupVer.innerHTML = `Phiên bản: v${currentVer} <span style="color:var(--alert-color); font-weight:bold;">(Có bản mới: v${newVer})</span>`;
        else if (currentVer !== "Unknown") setupVer.innerText = `Phiên bản: v${currentVer} (Mới nhất)`;
    }
    toggleOtaBadge(show) {
        const btn = document.getElementById('btn-ota-update'), badge = document.getElementById('ota-badge');
        if (btn && badge) { btn.style.display = show ? 'block' : 'none'; badge.style.display = show ? 'block' : 'none'; }
    }

    // Modal Config WiFi / Scan
    populateWiFiList(networks) {
        this.hideLoading();
        const select = document.getElementById('wifi-ssid'); 
        select.innerHTML = '<option value="">-- Chọn mạng WiFi --</option>';
        if(networks && networks.length > 0) networks.forEach(net => { select.innerHTML += `<option value="${net.ssid}">${net.ssid}</option>`; });
        else select.innerHTML = '<option value="">Không tìm thấy WiFi nào</option>';
    }

    renderEspNowResults(devices) {
        const container = document.getElementById('scan-list-container');
        if (devices && devices.length > 0) {
            container.innerHTML = devices.map(d => `
                <div class="control-card" style="display:flex; justify-content:space-between; align-items:center; padding: 12px; background: #fffbeb;">
                    <div style="display:flex; align-items:center; gap: 10px;">
                        <div style="font-size: 24px;">📡</div>
                        <div><div style="font-weight:bold;">MAC: ${d.mac}</div></div>
                    </div>
                </div>`).join('');
        } else {
            container.innerHTML = `<div class="empty-state">Không tìm thấy thiết bị chờ ghép nối.</div>`;
        }
    }

    // OTA UI Progress
    startFakeOtaProgress() {
        this.closeConfirm();
        document.getElementById('header-normal').style.display = 'none'; document.getElementById('header-ota').style.display = 'flex';
        document.getElementById('header-ota-text').innerText = "Đang tải xuống Firmware...";
    }
    showOtaProgress(percent) {
        document.getElementById('header-ota-bar').style.width = percent + '%';
        document.getElementById('header-ota-percent').innerText = percent + '%';
        if (percent >= 100) setTimeout(() => { window.location.reload(); }, 5000);
    }
    cancelOtaProgress(errStr) {
        document.getElementById('header-normal').style.display = 'flex'; document.getElementById('header-ota').style.display = 'none';
        this.showAlert("OTA Thất bại", errStr, "❌");
    }

    // --- KHU VỰC THÊM/SỬA THIẾT BỊ (UPSERT) ---

    selectDeviceType(type) {
        Store.set('tempDeviceType', type);
        Store.set('editingDeviceId', null);
        this.closeModal('modal-select-type');

        // Reset form cho thêm mới
        document.getElementById('config-title').innerText = 'Thêm mới thiết bị';
        document.getElementById('dev-mac').value = '';
        document.getElementById('dev-cycle-enable').checked = false;
        this.toggleCycleSettings(false);
        this.toggleConnectionFields();
        
        // Load danh sách chân GPIO hiện có
        document.getElementById('dev-pin').innerHTML = Store.get('HARDWARE_PINS').map(p => `<option value="${p.pin}">${p.label}</option>`).join('');

        this.openModal('modal-config-device');
    }

    editDevice(id) {
        const dev = Store.get('devices').find(d => d.id === id);
        if (!dev) return;

        Store.set('editingDeviceId', id);
        Store.set('tempDeviceType', dev.type);
        document.getElementById('config-title').innerText = 'Chỉnh sửa: ' + dev.name;

        // Điền dữ liệu cũ vào form
        document.getElementById('dev-connection-type').value = dev.connectionType || 'wired';
        this.toggleConnectionFields();

        if (dev.connectionType === 'espnow') {
            document.getElementById('dev-mac').value = dev.macAddress || '';
        } else {
            document.getElementById('dev-pin').innerHTML = Store.get('HARDWARE_PINS').map(p => `<option value="${p.pin}">${p.label}</option>`).join('');
            document.getElementById('dev-pin').value = dev.pin;
        }

        document.getElementById('dev-zone').value = dev.zone;
        document.getElementById('dev-threshold').value = dev.threshold || 25;
        document.getElementById('threshold-val').innerText = dev.threshold || 25;

        document.getElementById('dev-cycle-enable').checked = dev.isCycleMode || false;
        this.toggleCycleSettings(dev.isCycleMode || false);
        document.getElementById('dev-cycle-on').value = dev.cycleOn || 1;
        document.getElementById('dev-cycle-off').value = dev.cycleOff || 5;

        this.openModal('modal-config-device');
    }

    submitDeviceConfig() {
        const type = Store.get('tempDeviceType');
        const isEspNow = document.getElementById('dev-connection-type').value === 'espnow';

        // Gom dữ liệu từ Form
        const deviceData = {
            id: Store.get('editingDeviceId') || `dev_${Date.now()}`,
            type: type,
            name: document.getElementById('config-title').innerText.includes('Chỉnh sửa') ? 
                  Store.get('devices').find(d=>d.id === Store.get('editingDeviceId')).name : 
                  MasterData.deviceTypeNames[type],
            connectionType: document.getElementById('dev-connection-type').value,
            pin: isEspNow ? 99 : parseInt(document.getElementById('dev-pin').value),
            macAddress: isEspNow ? document.getElementById('dev-mac').value.trim().toUpperCase() : "",
            zone: document.getElementById('dev-zone').value,
            threshold: parseInt(document.getElementById('dev-threshold').value),
            isCycleMode: document.getElementById('dev-cycle-enable').checked,
            cycleOn: parseInt(document.getElementById('dev-cycle-on').value),
            cycleOff: parseInt(document.getElementById('dev-cycle-off').value),
            state: 'OFF'
        };

        // Giữ nguyên trạng thái (ON/OFF) nếu đang Edit, tránh việc lưu xong bị tắt quạt
        if (Store.get('editingDeviceId')) {
            const oldDev = Store.get('devices').find(d => d.id === Store.get('editingDeviceId'));
            if (oldDev) deviceData.state = oldDev.state;
        }

        // Bắn dữ liệu sang Controller để xử lý Upsert (Cloud/Local)
        App.DeviceCtrl.saveDevice(deviceData);
    }

    // --- CÁC HÀM PHỤ TRỢ (DOM) CHO MODAL ---
    toggleConnectionFields() {
        const type = document.getElementById('dev-connection-type').value;
        if (type === 'espnow') {
            document.getElementById('group-dev-pin').classList.add('hidden');
            document.getElementById('group-dev-mac').classList.remove('hidden');
        } else {
            document.getElementById('group-dev-pin').classList.remove('hidden');
            document.getElementById('group-dev-mac').classList.add('hidden');
        }
    }

    toggleCycleSettings(isChecked) {
        if (isChecked) document.getElementById('cycle-timers').classList.remove('hidden');
        else document.getElementById('cycle-timers').classList.add('hidden');
    }

    autoFillAnimalByZone() {
        const zone = document.getElementById('dev-zone').value;
        const zData = MasterData.zones.find(z => z.id === zone);
        if (zData && zData.animal !== 'none') {
            document.getElementById('dev-animal').value = zData.animal;
            this.applySmartRecommendation();
        } else {
            document.getElementById('dev-animal').value = 'none';
        }
    }

    applySmartRecommendation() {
        const animal = document.getElementById('dev-animal').value;
        if (animal !== 'none') {
            const data = MasterData.animalData[animal];
            document.getElementById('dev-threshold').value = data.temp;
            document.getElementById('threshold-val').innerText = data.temp;
            document.getElementById('dev-cycle-enable').checked = true;
            this.toggleCycleSettings(true);
            document.getElementById('dev-cycle-on').value = data.cycleOn;
            document.getElementById('dev-cycle-off').value = data.cycleOff;
        }
    }
}