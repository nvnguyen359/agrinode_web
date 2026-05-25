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

    // BẬT TIẾN TRÌNH OTA TỪ THỰC TẾ
    showOtaProgress: function(percent) {
        UI.closeConfirm();
        document.getElementById('header-normal').style.display = 'none';
        document.getElementById('header-ota').style.display = 'flex';
        
        // Hủy bộ đếm fake nếu có tín hiệu % thật từ mạch gửi lên qua MQTT
        if(window.fakeOtaInterval) { clearInterval(window.fakeOtaInterval); window.fakeOtaInterval = null; }

        document.getElementById('header-ota-bar').style.width = percent + '%';
        document.getElementById('header-ota-percent').innerText = percent + '%';
        
        if (percent >= 100) {
            document.getElementById('header-ota-text').innerText = "Thành công! Đang khởi động lại...";
            document.getElementById('header-ota-percent').innerText = "OK";
            setTimeout(() => { window.location.reload(); }, 5000);
        }
    },

    // BẬT GIẢ LẬP TIẾN TRÌNH TRÁNH BỊ ĐƠ UI
    startFakeOtaProgress: function() {
        UI.closeConfirm();
        document.getElementById('header-normal').style.display = 'none';
        document.getElementById('header-ota').style.display = 'flex';
        
        let fakePercent = 0;
        document.getElementById('header-ota-bar').style.width = '0%';
        document.getElementById('header-ota-percent').innerText = '0%';
        document.getElementById('header-ota-text').innerText = "☁️ Đang tải và nạp Firmware...";
        
        if(window.fakeOtaInterval) clearInterval(window.fakeOtaInterval);
        
        // Giả lập tiến trình: mỗi 0.8s tăng 1%, dừng lại ở 95% đợi mạch hoàn tất và khởi động lại
        window.fakeOtaInterval = setInterval(() => {
            if (fakePercent < 95) {
                fakePercent += 1;
                document.getElementById('header-ota-bar').style.width = fakePercent + '%';
                document.getElementById('header-ota-percent').innerText = fakePercent + '%';
            } else {
                document.getElementById('header-ota-text').innerText = "⏳ Đang xử lý... (Vui lòng chờ)";
            }
        }, 800);
        
        // Đã xóa bỏ setTimeout 120000 ép reload trang ở đây
    },

    updateVersionUI: function(currentVer, newVer = null) {
        const headerVer = document.getElementById('header-version');
        if (headerVer) headerVer.innerText = (currentVer && currentVer !== "Unknown") ? `v${currentVer}` : 'Đang tải...';

        const setupVer = document.getElementById('current-version-text');
        if (!setupVer) return;

        if (newVer && newVer !== currentVer && currentVer !== "Unknown") {
            setupVer.innerHTML = `Phiên bản: v${currentVer} <span style="color:var(--alert-color); font-weight:bold;">(Có bản mới: v${newVer})</span>`;
        } else if (currentVer !== "Unknown") {
            setupVer.innerText = `Phiên bản: v${currentVer} (Mới nhất)`;
        } else {
            setupVer.innerText = `Phiên bản: Đang tải...`;
        }
    },
    toggleOtaBadge: function(show) {
        const btn = document.getElementById('btn-ota-update');
        const badge = document.getElementById('ota-badge');
        if (btn && badge) {
            btn.style.display = show ? 'block' : 'none';
            badge.style.display = show ? 'block' : 'none';
        }
    },

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
                const displayLabel = item.label.includes('(') ? item.label : `Chân ${item.label} (GPIO ${item.pin})`;
                html += `<option value="${item.pin}" ${parseInt(item.pin) === parseInt(currentPin) ? 'selected' : ''}>${displayLabel}</option>`;
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
        
        if (State.activeZone === 'all') {
            const allEnabled = State.settings.zoneCycles && State.settings.zoneCycles.every(zc => zc.enabled) && State.settings.zoneCycles.length === MasterData.zones.filter(z => z.id !== 'all').length && State.settings.zoneCycles.length > 0;
            html += `<div style="display:flex; justify-content:flex-end; margin-bottom: 15px;">
                        <label style="display:flex; align-items:center; gap:8px; font-weight:600; cursor:pointer; background:#fff; padding:8px 12px; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                            <input type="checkbox" ${allEnabled ? 'checked' : ''} onchange="App.toggleAllZoneCycles(this.checked)"> Luân phiên toàn bộ
                        </label>
                     </div>`;
        }
        
        zonesToRender.forEach(z => {
            const devsInZone = State.devices.filter(d => d.zone === z.id);
            if (devsInZone.length > 0) {
                const zc = State.settings.zoneCycles ? State.settings.zoneCycles.find(x => x.zone === z.id) : null;
                const isZoneCycle = zc ? zc.enabled : false;
                const cycleTime = zc ? zc.cycleTime : 5;
                
                let timeOptions = '';
                [1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50].forEach(t => {
                    timeOptions += `<option value="${t}" ${cycleTime == t ? 'selected' : ''}>${t}p</option>`;
                });
                
                let cycleCtrlHtml = `
                    <div style="display:flex; align-items:center; gap:10px; font-size:0.9rem; font-weight:normal;">
                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer; color: var(--text-main);">
                            <input type="checkbox" ${isZoneCycle ? 'checked' : ''} onchange="App.toggleZoneCycle('${z.id}', this.checked, document.getElementById('zt-${z.id}').value)"> Quạt luân phiên
                        </label>
                        <select id="zt-${z.id}" onchange="if(this.previousElementSibling.firstElementChild.checked) App.toggleZoneCycle('${z.id}', true, this.value)" style="display:${isZoneCycle ? 'block' : 'none'}; padding:2px 5px; border-radius:4px; border:1px solid #ccc; font-size:0.85rem;">
                            ${timeOptions}
                        </select>
                    </div>
                `;
                
                html += `<div class="zone-card">
                            <div class="zone-group-title" style="display:flex; justify-content:space-between; align-items:center;">
                                <div>${z.icon} Khu vực: ${z.name}</div>
                                ${cycleCtrlHtml}
                            </div>`;
                devsInZone.forEach(dev => html += UI.createDeviceCard(dev, isZoneCycle));
                html += `</div>`;
            }
        });
        container.innerHTML = html || '<div class="empty-state">Khu vực này trống.</div>';
    },

    createDeviceCard: function(dev, isZoneCycleOverridden) {
        const isOn = dev.state === 'ON';
        let statusText = isOn ? 'Đang chạy' : 'Đã tắt';
        
        let isDevCycle = dev.isCycleMode && !isZoneCycleOverridden;
        let statusIcon = isDevCycle ? (isOn ? '<span class="icon-pulse icon-spin">🔄</span>' : '<span class="icon-pulse">🔄</span>') : '';
        if (isZoneCycleOverridden && dev.type === 'fan') {
            statusIcon = isOn ? '<span class="icon-pulse icon-spin">🔄</span>' : '<span class="icon-pulse">🔄</span>';
        }
        
        let timerHtml = ''; 

        if (isZoneCycleOverridden && dev.type === 'fan') {
            statusText = `Luân phiên khu vực - ${isOn ? 'Đang bật' : 'Đang nghỉ'}`;
            timerHtml = `<div id="timer-${dev.id}" style="color: var(--text-main); margin-top: 6px; font-size: 0.85rem; display:flex; gap: 5px; align-items: center; background: #eff6ff; border: 1px dashed #93c5fd; padding: 4px 8px; border-radius: 6px; width: fit-content;">⏳ Đang đồng bộ...</div>`;
        } else if (isDevCycle) { 
            statusText = `Luân phiên (${dev.cycleOn}p/${dev.cycleOff}p) - ${isOn ? 'Đang bật' : 'Đang nghỉ'}`;
            timerHtml = `<div id="timer-${dev.id}" style="color: var(--text-main); margin-top: 6px; font-size: 0.85rem; display:flex; gap: 5px; align-items: center; background: #fef2f2; border: 1px dashed #fca5a5; padding: 4px 8px; border-radius: 6px; width: fit-content;">⏳ Đang đồng bộ...</div>`;
        }
        
        const pinObj = State.HARDWARE_PINS.find(p => parseInt(p.pin) === parseInt(dev.pin));
        const shortPinLabel = pinObj ? pinObj.label.split(' ')[0] : `GPIO ${dev.pin}`;

        let toggleHtml = `<label class="toggle-switch" style="margin-top: 5px; ${isZoneCycleOverridden && dev.type === 'fan' ? 'opacity:0.5; pointer-events:none;' : ''}">
                    <input type="checkbox" ${isOn ? 'checked' : ''} onchange="App.toggleRelay('${dev.id}', this.checked)">
                    <span class="slider"></span>
                </label>`;

        return `
        <div class="control-card" style="flex-direction: column; align-items: stretch; gap: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div class="control-info" style="align-items: flex-start;">
                    <div class="device-icon ${isOn ? `bg-${dev.type}-on` : ''}" style="margin-top: 2px;">${MasterData.svgs[dev.type].replace('{ON_CLASS}', isOn ? 'on' : '')}</div>
                    <div>
                        <div class="control-name">${dev.name}</div>
                        <div class="control-state">${statusIcon} <span>${statusText} (${shortPinLabel})</span></div>
                        ${timerHtml}
                    </div>
                </div>
                ${toggleHtml}
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
        if (data.devices) { 
            data.devices.forEach(r => { 
                const dev = State.devices.find(d => d.id === r.id); 
                if(dev) {
                    if (dev.state !== r.state) { dev.state = r.state; changed = true; }
                    if (r.timeLeft !== undefined) dev.timeLeft = r.timeLeft;
                } 
            }); 
        }
        if(changed) UI.renderDevices();
    },

    openDeviceModal: function() { State.editingDeviceId = null; UI.openModal('modal-select-type'); },
    selectDeviceType: function(type) {
        State.tempDeviceType = type; UI.closeModal('modal-select-type'); document.getElementById('dev-name').value = '';
        document.getElementById('dev-cycle-enable').checked = false; UI.toggleCycleSettings(false); UI.renderPinSelect(); UI.autoFillAnimalByZone();
        document.getElementById('smart-animal-config').style.display = (type === 'fan' || type === 'heater') ? 'block' : 'none';
        document.getElementById('config-cycle').style.display = (type === 'fan' || type === 'pump') ? 'block' : 'none';
        UI.checkCycleOverrideWarning(type, document.getElementById('dev-zone').value);
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
        UI.checkCycleOverrideWarning(State.tempDeviceType, dev.zone);
        
        // Cập nhật lại event listener cho select zone
        document.getElementById('dev-zone').onchange = () => {
            UI.autoFillAnimalByZone();
            UI.checkCycleOverrideWarning(State.tempDeviceType, document.getElementById('dev-zone').value);
        };
        
        document.getElementById('config-title').innerText = "Sửa thiết bị"; UI.openModal('modal-config-device');
    },
    autoFillAnimalByZone: function() { const z = MasterData.zones.find(x => x.id === document.getElementById('dev-zone').value); if(z && z.animal !== 'none') { document.getElementById('dev-animal').value = z.animal; UI.applySmartRecommendation(); } },
    applySmartRecommendation: function() {
        const animal = document.getElementById('dev-animal').value; if (animal === 'none' || !MasterData.animalData[animal]) return; const d = MasterData.animalData[animal];
        document.getElementById('dev-threshold').value = d.temp; document.getElementById('threshold-val').innerText = d.temp;
        if (State.tempDeviceType === 'fan') { document.getElementById('dev-cycle-enable').checked = true; UI.toggleCycleSettings(true); document.getElementById('dev-cycle-on').value = d.cycleOn; document.getElementById('dev-cycle-off').value = d.cycleOff; }
    },
    toggleCycleSettings: function(show) { document.getElementById('cycle-timers').className = show ? 'mt-20 grid-2' : 'hidden mt-20 grid-2'; },

    checkCycleOverrideWarning: function(devType, devZone) {
        let isOverridden = false;
        if (devType === 'fan' && devZone !== 'all') {
            const zc = State.settings.zoneCycles ? State.settings.zoneCycles.find(x => x.zone === devZone) : null;
            if (zc && zc.enabled) isOverridden = true;
        }
        const msgEl = document.getElementById('cycle-override-msg');
        if (msgEl) {
            msgEl.style.display = isOverridden ? 'block' : 'none';
        }
        
        // Disable individual cycle inputs if overridden
        const cbEnable = document.getElementById('dev-cycle-enable');
        const inputOn = document.getElementById('dev-cycle-on');
        const inputOff = document.getElementById('dev-cycle-off');
        if (cbEnable) cbEnable.disabled = isOverridden;
        if (inputOn) inputOn.disabled = isOverridden;
        if (inputOff) inputOff.disabled = isOverridden;
        
        if (isOverridden && cbEnable) {
            cbEnable.checked = false;
            UI.toggleCycleSettings(false);
        }
        
        return isOverridden;
    },

    togglePassword: function() { const i = document.getElementById('wifi-pass'); i.type = (i.type === 'password') ? 'text' : 'password'; },
    
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