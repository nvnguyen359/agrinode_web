// ui.js - Quản lý Giao diện người dùng (DOM Manipulation)
const UI = {
    showLoading: function(txt) {
        const l = document.getElementById('loading');
        if(l) { document.getElementById('loading-text').innerText = txt; l.classList.remove('hidden'); }
    },
    hideLoading: function() {
        const l = document.getElementById('loading');
        if(l) l.classList.add('hidden');
    },
    navigate: function(id) {
        document.querySelectorAll('.page, .nav-item').forEach(e => e.classList.remove('active'));
        document.getElementById('view-' + id).classList.add('active');
        document.getElementById('nav-' + id).classList.add('active');
    },

    // --- CUSTOM MODALS ---
    showAlert: function(title, message, icon = 'ℹ️') {
        document.getElementById('alert-title').innerText = title;
        document.getElementById('alert-message').innerText = message;
        document.getElementById('alert-icon').innerText = icon;
        document.getElementById('modal-alert').classList.remove('hidden');
    },
    closeAlert: function() {
        document.getElementById('modal-alert').classList.add('hidden');
    },
    showConfirm: function(title, message, onConfirm, icon = '❓', isDanger = false) {
        document.getElementById('confirm-title').innerText = title;
        document.getElementById('confirm-message').innerText = message;
        document.getElementById('confirm-icon').innerText = icon;
        
        const btnOk = document.getElementById('btn-confirm-ok');
        btnOk.style.background = isDanger ? '#ef4444' : '#3b82f6';
        
        // Remove old event listener (Tránh trigger nhiều lần)
        const newBtn = btnOk.cloneNode(true);
        btnOk.parentNode.replaceChild(newBtn, btnOk);
        
        newBtn.addEventListener('click', () => {
            UI.closeConfirm();
            if(onConfirm) onConfirm();
        });
        document.getElementById('modal-confirm').classList.remove('hidden');
    },
    closeConfirm: function() {
        document.getElementById('modal-confirm').classList.add('hidden');
    },
    openModal: function(id) { document.getElementById(id).classList.remove('hidden'); },
    closeModal: function(id) { document.getElementById(id).classList.add('hidden'); },

    // --- RENDER LOGIC ---
    renderZones: function() {
        const container = document.getElementById('zone-container');
        const usedZoneIds = new Set(State.devices.map(d => d.zone));
        const visibleZones = MasterData.zones.filter(z => z.id === 'all' || usedZoneIds.has(z.id));
        if (visibleZones.length <= 1) {
            container.style.display = 'none';
            if(State.activeZone !== 'all') { State.activeZone = 'all'; UI.renderDevices(); }
        } else {
            container.style.display = 'flex';
            container.innerHTML = visibleZones.map(z => `<button class="chip ${State.activeZone === z.id ? 'active' : ''}" onclick="UI.selectZone('${z.id}')">${z.icon} ${z.name}</button>`).join('');
        }
    },
    selectZone: function(id) { 
        State.activeZone = id; UI.renderZones(); UI.renderDevices(); 
        const z = MasterData.zones.find(x => x.id === id);
        document.getElementById('sensor-title').innerText = id === 'all' ? 'Cảm biến: Tất cả khu vực' : `Cảm biến: ${z.icon} ${z.name}`; 
    },
    renderPinSelect: function(currentPin = null) {
        const usedPins = State.devices.map(d => parseInt(d.pin));
        let html = ''; let hasAvailable = false;
        State.HARDWARE_PINS.forEach(item => {
            if (!usedPins.includes(parseInt(item.pin)) || parseInt(item.pin) === parseInt(currentPin)) {
                html += `<option value="${item.pin}" ${parseInt(item.pin) === parseInt(currentPin) ? 'selected' : ''}>Chân ${item.label} (GPIO ${item.pin})</option>`;
                hasAvailable = true;
            }
        });
        document.getElementById('dev-pin').innerHTML = hasAvailable ? html : '<option value="" disabled selected>Đã hết chân trống!</option>';
    },
    renderDevices: function() {
        const container = document.getElementById('device-list');
        if (State.devices.length === 0) return container.innerHTML = '<div class="empty-state">Chưa có thiết bị nào. Hãy thêm mới!</div>';
        let html = '';
        const zonesToRender = State.activeZone === 'all' ? MasterData.zones.filter(z => z.id !== 'all') : [MasterData.zones.find(z => z.id === State.activeZone)];
        zonesToRender.forEach(z => {
            const devsInZone = State.devices.filter(d => d.zone === z.id);
            if (devsInZone.length > 0) {
                html += `<div class="zone-card"><div class="zone-group-title">${z.icon} Khu vực: ${z.name}</div>`;
                devsInZone.forEach(dev => html += UI.createDeviceCard(dev));
                html += `</div>`;
            }
        });
        container.innerHTML = html || '<div class="empty-state">Khu vực này trống.</div>';
    },
    createDeviceCard: function(dev) {
        const isOn = dev.state === 'ON';
        let statusText = isOn ? 'Đang chạy' : 'Đã tắt';
        let statusIcon = dev.isCycleMode ? (isOn ? '<span class="icon-pulse icon-spin">🔄</span>' : '<span class="icon-pulse">🔄</span>') : '';
        if (dev.isCycleMode) statusText = `Luân phiên (${dev.cycleOn}p/${dev.cycleOff}p) - ${isOn ? 'Đang quay' : 'Đang nghỉ'}`;
        const pinObj = State.HARDWARE_PINS.find(p => parseInt(p.pin) === parseInt(dev.pin));
        return `
        <div class="control-card" style="flex-direction: column; align-items: stretch; gap: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div class="control-info">
                    <div class="device-icon ${isOn ? `bg-${dev.type}-on` : ''}">${MasterData.svgs[dev.type].replace('{ON_CLASS}', isOn ? 'on' : '')}</div>
                    <div><div class="control-name">${dev.name}</div><div class="control-state">${statusIcon} <span>${statusText} (Chân ${pinObj ? pinObj.label : dev.pin})</span></div></div>
                </div>
                <label class="toggle-switch">
                    <input type="checkbox" ${isOn ? 'checked' : ''} onchange="App.toggleRelay('${dev.id}', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
            <div class="device-actions">
                <button class="btn-text btn-edit" onclick="UI.openEditModal('${dev.id}')">✏️ Sửa</button>
                <button class="btn-text btn-delete" onclick="App.deleteDevicePrompt('${dev.id}')">🗑️ Xóa</button>
            </div>
        </div>`;
    },
    updateTelemetryUI: function(data) {
        if(data.temp !== undefined) document.getElementById('val-temp').innerText = data.temp;
        if(data.hum !== undefined) document.getElementById('val-hum').innerText = data.hum;
        const z = MasterData.zones.find(x => x.id === State.activeZone); const cardTemp = document.getElementById('card-temp');
        if (State.activeZone !== 'all' && z.alertTemp > 0 && parseFloat(data.temp) < z.alertTemp) cardTemp.classList.add('alert-card'); else cardTemp.classList.remove('alert-card');
        let changed = false;
        if (data.devices) { data.devices.forEach(r => { const dev = State.devices.find(d => d.id === r.id); if(dev && dev.state !== r.state) { dev.state = r.state; changed = true; } }); }
        if(changed) UI.renderDevices();
    },

    // --- CÁC HÀM XỬ LÝ FORM ---
    openDeviceModal: function() { State.editingDeviceId = null; UI.openModal('modal-select-type'); },
    selectDeviceType: function(type) {
        State.tempDeviceType = type; UI.closeModal('modal-select-type'); document.getElementById('dev-name').value = '';
        document.getElementById('dev-cycle-enable').checked = false; UI.toggleCycleSettings(false); UI.renderPinSelect(); UI.autoFillAnimalByZone();
        document.getElementById('smart-animal-config').style.display = (type === 'fan' || type === 'heater') ? 'block' : 'none';
        document.getElementById('config-cycle').style.display = (type === 'fan' || type === 'pump') ? 'block' : 'none';
        document.getElementById('config-title').innerText = "Thêm thiết bị mới"; UI.openModal('modal-config-device');
    },
    openEditModal: function(id) {
        State.editingDeviceId = id; const dev = State.devices.find(d => d.id === id); if(!dev) return; State.tempDeviceType = dev.type;
        document.getElementById('dev-name').value = dev.name; document.getElementById('dev-zone').value = dev.zone;
        document.getElementById('dev-cycle-enable').checked = dev.isCycleMode;
        if(dev.isCycleMode) { document.getElementById('dev-cycle-on').value = dev.cycleOn; document.getElementById('dev-cycle-off').value = dev.cycleOff; }
        UI.toggleCycleSettings(dev.isCycleMode); UI.renderPinSelect(dev.pin); 
        document.getElementById('smart-animal-config').style.display = (State.tempDeviceType === 'fan' || State.tempDeviceType === 'heater') ? 'block' : 'none';
        document.getElementById('config-cycle').style.display = (State.tempDeviceType === 'fan' || State.tempDeviceType === 'pump') ? 'block' : 'none';
        document.getElementById('config-title').innerText = "Sửa thiết bị"; UI.openModal('modal-config-device');
    },
    autoFillAnimalByZone: function() { const z = MasterData.zones.find(x => x.id === document.getElementById('dev-zone').value); if(z && z.animal !== 'none') { document.getElementById('dev-animal').value = z.animal; UI.applySmartRecommendation(); } },
    applySmartRecommendation: function() {
        const animal = document.getElementById('dev-animal').value; if (animal === 'none' || !MasterData.animalData[animal]) return; const d = MasterData.animalData[animal];
        document.getElementById('dev-threshold').value = d.temp; document.getElementById('threshold-val').innerText = d.temp;
        if (State.tempDeviceType === 'fan') { document.getElementById('dev-cycle-enable').checked = true; UI.toggleCycleSettings(true); document.getElementById('dev-cycle-on').value = d.cycleOn; document.getElementById('dev-cycle-off').value = d.cycleOff; }
    },
    toggleCycleSettings: function(show) { document.getElementById('cycle-timers').className = show ? 'mt-20 grid-2' : 'hidden mt-20 grid-2'; },
    togglePassword: function() { const i = document.getElementById('wifi-pass'); i.type = (i.type === 'password') ? 'text' : 'password'; },
    
    // HIỂN THỊ DANH SÁCH WIFI
    populateWiFiList: function(networks) {
        UI.hideLoading();
        const select = document.getElementById('wifi-ssid'); 
        select.innerHTML = '<option value="">-- Chọn mạng WiFi --</option>';
        if(networks && networks.length > 0) {
            networks.forEach(net => { select.innerHTML += `<option value="${net.ssid}">${net.ssid}</option>`; });
        } else {
            select.innerHTML = '<option value="">Không tìm thấy WiFi nào</option>';
        }
    }
};