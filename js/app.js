// ==========================================
// FULL CODE app.js - HIVEMQ PRIVATE CLOUD EDITION
// ==========================================

const MAC_ADDRESS = "CC50E3DADF75"; 

let HARDWARE_PINS = []; 
let BOARD_NAME = "Unknown Board";
let devices = [];
let activeZone = 'all';
let tempDeviceType = '';
let editingDeviceId = null; 

const isLocal = window.location.hostname.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/) || window.location.hostname === 'localhost' || window.location.hostname.includes('.local');

let currentPin = localStorage.getItem('agrinode_pin') || ""; 

// --- CẤU HÌNH MÁY CHỦ HIVEMQ CLOUD (PRIVATE) ---
const MQTT_BROKER = "cf506bbbf20d4561a8b37f7239c9ca88.s1.eu.hivemq.cloud";
const MQTT_PORT = 8884; // Port WSS bắt buộc cho HiveMQ Cloud
const MQTT_USER = "nvnguyen2504";
const MQTT_PASS = "Mothaiba123";

let isMqttConnected = false;
let mqttClient = null;
let isWaitingForConnection = false; 

const clientId = "WebClient_" + Math.random().toString(16).substr(2, 8);

const zones = [
    { id: 'all', name: 'Tất cả', icon: '🏠', animal: 'none' },
    { id: 'z_pig', name: 'Lợn sơ sinh', icon: '🐷', animal: 'pig_baby', alertTemp: 28 },
    { id: 'z_chicken', name: 'Gà úm', icon: '🐣', animal: 'chicken_baby', alertTemp: 32 },
    { id: 'z_pig_adult', name: 'Lợn thịt', icon: '🐖', animal: 'pig', alertTemp: 0 }
];

const animalData = {
    'chicken_baby': { temp: 34, cycleOn: 1, cycleOff: 5 },
    'chicken_adult': { temp: 20, cycleOn: 2, cycleOff: 5 },
    'pig_baby': { temp: 32, cycleOn: 1, cycleOff: 10 },
    'pig': { temp: 24, cycleOn: 2, cycleOff: 10 }
};

const deviceTypeNames = { 'fan': 'Quạt thông gió', 'heater': 'Đèn sưởi', 'pump': 'Máy bơm' };

const svgs = {
    'fan': `<svg class="svg-icon icon-fan {ON_CLASS}" viewBox="0 0 24 24"><g transform="translate(12, 12)"><path d="M0 -1C1.5 -1.5,2.5 -3,2.5 -5C2.5 -6.5,1.5 -7.5,0 -7.5C-1.5 -7.5,-2.5 -6.5,-2.5 -5C-2.5 -3,-1.5 -1.5,0 -1Z"/><path d="M0 -1C1.5 -1.5,2.5 -3,2.5 -5C2.5 -6.5,1.5 -7.5,0 -7.5C-1.5 -7.5,-2.5 -6.5,-2.5 -5C-2.5 -3,-1.5 -1.5,0 -1Z" transform="rotate(120)"/><path d="M0 -1C1.5 -1.5,2.5 -3,2.5 -5C2.5 -6.5,1.5 -7.5,0 -7.5C-1.5 -7.5,-2.5 -6.5,-2.5 -5C-2.5 -3,-1.5 -1.5,0 -1Z" transform="rotate(240)"/></g><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`,
    'heater': `<svg class="svg-icon icon-heater {ON_CLASS}" viewBox="0 0 24 24"><path d="M9 18h6" /><path d="M10 21h4" /><path d="M12 15v-6" /><path d="M12 2a7 7 0 0 1 7 7c0 2.5 -1.5 4.5 -3 6v1a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-1c-1.5 -1.5 -3 -3.5 -3 -6a7 7 0 0 1 7 -7z" /></svg>`,
    'pump': `<svg class="svg-icon icon-pump {ON_CLASS}" viewBox="0 0 24 24"><path d="M12 3l-6 8a8 8 0 1 0 12 0l-6 -8z" /><path d="M12 15v-2" /><path d="M12 19v-2" /></svg>`
};

window.onload = async () => {
    document.getElementById('dev-zone').innerHTML = zones.filter(z => z.id !== 'all').map(z => `<option value="${z.id}">${z.icon} ${z.name}</option>`).join('');
    
    if (isLocal) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const infoRes = await fetch('/api/info', { signal: controller.signal });
            clearTimeout(timeoutId);
            const infoData = await infoRes.json();
            HARDWARE_PINS = infoData.hardware_pins;
        } catch (e) { loadDefaultPins(); }
        await fetchLocalDevices(); 
    } else {
        loadDefaultPins();
    }

    if (currentPin) {
        document.getElementById('pin-lock-overlay').classList.add('hidden');
        showLoading("Đang kết nối hệ thống...");
    } else {
        document.getElementById('pin-lock-overlay').classList.remove('hidden');
    }

    setupMQTT();
    navigate('dashboard');
};

function loadDefaultPins() {
    const pins = [4, 5, 12, 13, 14, 15, 16]; 
    HARDWARE_PINS = pins.map(p => ({pin: p, label: 'D'+p}));
}

async function fetchLocalDevices() {
    if (!isLocal) return;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const res = await fetch('/api/devices', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) { devices = await res.json(); renderZones(); renderDevices(); }
    } catch(e) {}
}

async function checkPin() {
    const inputStr = document.getElementById('secret-pin-input').value;
    if (inputStr.length < 6) return; 

    document.getElementById('pin-error-msg').style.display = 'none';

    if (isLocal) {
        showLoading("Đang xác thực mã PIN...");
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: inputStr })
            });
            const data = await res.json();
            
            if (data.success) {
                currentPin = inputStr; 
                localStorage.setItem('agrinode_pin', currentPin);
                document.getElementById('pin-lock-overlay').classList.add('hidden');
                
                await fetchLocalDevices(); 
                hideLoading();
                return;
            } else {
                hideLoading();
                document.getElementById('pin-error-msg').style.display = 'block';
                document.getElementById('secret-pin-input').value = '';
                return;
            }
        } catch (err) {
            hideLoading();
            alert("Không thể kết nối đến mạch ESP. Vui lòng thử lại!");
            return;
        }
    }

    if (!isMqttConnected || !mqttClient) {
        document.getElementById('pin-status-msg').style.display = 'block'; 
        document.getElementById('btn-unlock').disabled = true; 
        document.getElementById('btn-unlock').style.opacity = '0.5';
        currentPin = inputStr; 
        isWaitingForConnection = true; 
        return; 
    }
    
    document.getElementById('pin-status-msg').style.display = 'none';
    document.getElementById('btn-unlock').disabled = false;
    document.getElementById('btn-unlock').style.opacity = '1';
    
    currentPin = inputStr; 
    showLoading("Đang xác thực mã PIN..."); 
    
    const message = new Paho.MQTT.Message(JSON.stringify({ cmd: "login", auth_pin: currentPin, client_id: clientId }));
    message.destinationName = `agrinode_${MAC_ADDRESS}/control`.toLowerCase();
    mqttClient.send(message);
}

function setupMQTT() {
    if (!mqttClient) {
        mqttClient = new Paho.MQTT.Client(MQTT_BROKER, MQTT_PORT, "/mqtt", clientId);
        
        mqttClient.onConnectionLost = () => { 
            isMqttConnected = false; 
            document.getElementById('connection-status').className = 'status-dot offline'; 
            setTimeout(doConnectMQTT, 3000); 
        };
        
        mqttClient.onMessageArrived = (msg) => {
            if (msg.retained) return; 

            const TOPIC_CONFIG = `agrinode_${MAC_ADDRESS}/config`.toLowerCase();
            const TOPIC_TELEMETRY = `agrinode_${MAC_ADDRESS}/telemetry`.toLowerCase();

            if (msg.destinationName === TOPIC_CONFIG) {
                const data = JSON.parse(msg.payloadString);
                
                if (data.auth) {
                    if (data.client_id && data.client_id !== clientId) return;

                    if (data.auth === "ok") {
                        localStorage.setItem('agrinode_pin', currentPin); 
                        document.getElementById('pin-lock-overlay').classList.add('hidden');
                        document.getElementById('pin-error-msg').style.display = 'none';
                        document.getElementById('pin-status-msg').style.display = 'none';
                        document.getElementById('btn-unlock').disabled = false;
                        document.getElementById('btn-unlock').style.opacity = '1';
                        
                        if (!isLocal) {
                            showLoading("Đang tải dữ liệu thiết bị...");
                            const confMsg = new Paho.MQTT.Message(JSON.stringify({ cmd: "get_config", auth_pin: currentPin, client_id: clientId }));
                            confMsg.destinationName = `agrinode_${MAC_ADDRESS}/control`.toLowerCase();
                            mqttClient.send(confMsg);
                        } else {
                            hideLoading();
                        }
                    } else {
                        hideLoading();
                        document.getElementById('pin-error-msg').style.display = 'block'; 
                        document.getElementById('secret-pin-input').value = '';
                        currentPin = ""; localStorage.removeItem('agrinode_pin');
                        
                        document.getElementById('pin-lock-overlay').classList.remove('hidden');
                        document.getElementById('pin-status-msg').style.display = 'none';
                        document.getElementById('btn-unlock').disabled = false;
                        document.getElementById('btn-unlock').style.opacity = '1';
                    }
                }

                let dataHasUpdated = false;
                if (data.hardware_pins) { 
                    HARDWARE_PINS = data.hardware_pins.map(p => typeof p === 'object' ? p : {pin: p, label: 'D'+p});
                    dataHasUpdated = true; 
                }
                if (data.devices) { devices = data.devices; dataHasUpdated = true; } 
                else if (Array.isArray(data)) { devices = data; dataHasUpdated = true; }
                
                if (dataHasUpdated) {
                    hideLoading(); 
                    renderZones(); renderPinSelect(); renderDevices();
                }
                
            } else if (msg.destinationName === TOPIC_TELEMETRY) {
                updateUIFromData(JSON.parse(msg.payloadString));
            }
        };
    }
    doConnectMQTT();
}

function doConnectMQTT() {
    if (isMqttConnected || !mqttClient) return; 
    
    mqttClient.connect({ 
        userName: MQTT_USER,        // Cấp quyền Username
        password: MQTT_PASS,        // Cấp quyền Password
        useSSL: true,               // Bắt buộc SSL cho HiveMQ Cloud
        timeout: 10,
        onSuccess: () => { 
            isMqttConnected = true; 
            document.getElementById('connection-status').className = 'status-dot online';
            mqttClient.subscribe(`agrinode_${MAC_ADDRESS}/telemetry`.toLowerCase()); 
            mqttClient.subscribe(`agrinode_${MAC_ADDRESS}/config`.toLowerCase()); 
            
            if (isWaitingForConnection && currentPin) {
                isWaitingForConnection = false;
                checkPin(); 
            }
            else if (currentPin && !isWaitingForConnection && !isLocal) {
                showLoading("Đang đồng bộ dữ liệu...");
                const msg = new Paho.MQTT.Message(JSON.stringify({ cmd: "get_config", auth_pin: currentPin, client_id: clientId }));
                msg.destinationName = `agrinode_${MAC_ADDRESS}/control`.toLowerCase();
                mqttClient.send(msg);
            }
        },
        onFailure: (err) => { 
            console.log("MQTT Error: ", err);
            setTimeout(doConnectMQTT, 3000); 
        }
    });
}

function renderZones() {
    const container = document.getElementById('zone-container');
    const usedZoneIds = new Set(devices.map(d => d.zone));
    const visibleZones = zones.filter(z => z.id === 'all' || usedZoneIds.has(z.id));
    if (visibleZones.length <= 1) {
        container.style.display = 'none';
        if(activeZone !== 'all') { activeZone = 'all'; renderDevices(); }
    } else {
        container.style.display = 'flex';
        container.innerHTML = visibleZones.map(z => `<button class="chip ${activeZone === z.id ? 'active' : ''}" onclick="selectZone('${z.id}')">${z.icon} ${z.name}</button>`).join('');
    }
}
function selectZone(id) { activeZone = id; renderZones(); renderDevices(); document.getElementById('sensor-title').innerText = id === 'all' ? 'Cảm biến: Tất cả khu vực' : `Cảm biến: ${zones.find(x => x.id === id).icon} ${zones.find(x => x.id === id).name}`; }

function renderPinSelect(currentPin = null) {
    const usedPins = devices.map(d => parseInt(d.pin));
    let html = ''; let hasAvailable = false;
    HARDWARE_PINS.forEach(item => {
        if (!usedPins.includes(parseInt(item.pin)) || parseInt(item.pin) === parseInt(currentPin)) {
            html += `<option value="${item.pin}" ${parseInt(item.pin) === parseInt(currentPin) ? 'selected' : ''}>Chân ${item.label} (GPIO ${item.pin})</option>`;
            hasAvailable = true;
        }
    });
    document.getElementById('dev-pin').innerHTML = hasAvailable ? html : '<option value="" disabled selected>Đã hết chân trống!</option>';
}

function renderDevices() {
    const container = document.getElementById('device-list');
    if (devices.length === 0) return container.innerHTML = '<div class="empty-state">Chưa có thiết bị nào. Hãy thêm mới!</div>';
    let html = '';
    const zonesToRender = activeZone === 'all' ? zones.filter(z => z.id !== 'all') : [zones.find(z => z.id === activeZone)];
    zonesToRender.forEach(z => {
        const devsInZone = devices.filter(d => d.zone === z.id);
        if (devsInZone.length > 0) {
            html += `<div class="zone-card"><div class="zone-group-title">${z.icon} Khu vực: ${z.name}</div>`;
            devsInZone.forEach(dev => html += createDeviceCard(dev));
            html += `</div>`;
        }
    });
    container.innerHTML = html || '<div class="empty-state">Khu vực này trống.</div>';
}

function createDeviceCard(dev) {
    const isOn = dev.state === 'ON';
    let statusText = isOn ? 'Đang chạy' : 'Đã tắt';
    let statusIcon = dev.isCycleMode ? (isOn ? '<span class="icon-pulse icon-spin">🔄</span>' : '<span class="icon-pulse">🔄</span>') : '';
    if (dev.isCycleMode) statusText = `Luân phiên (${dev.cycleOn}p/${dev.cycleOff}p) - ${isOn ? 'Đang quay' : 'Đang nghỉ'}`;
    const pinObj = HARDWARE_PINS.find(p => parseInt(p.pin) === parseInt(dev.pin));
    return `
    <div class="control-card" style="flex-direction: column; align-items: stretch; gap: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="control-info">
                <div class="device-icon ${isOn ? `bg-${dev.type}-on` : ''}">${svgs[dev.type].replace('{ON_CLASS}', isOn ? 'on' : '')}</div>
                <div><div class="control-name">${dev.name}</div><div class="control-state">${statusIcon} <span>${statusText} (Chân ${pinObj ? pinObj.label : dev.pin})</span></div></div>
            </div>
            <label class="toggle-switch">
                <input type="checkbox" ${isOn ? 'checked' : ''} onchange="toggleRelay('${dev.id}', this.checked)">
                <span class="slider"></span>
            </label>
        </div>
        <div class="device-actions">
            <button class="btn-text btn-edit" onclick="openEditModal('${dev.id}')">✏️ Sửa</button>
            <button class="btn-text btn-delete" onclick="deleteDevice('${dev.id}')">🗑️ Xóa</button>
        </div>
    </div>`;
}

function sendMqttAction(payloadObj, loadingMsg, onSuccess) {
    payloadObj.auth_pin = currentPin; 
    
    const executeSend = () => {
        const message = new Paho.MQTT.Message(JSON.stringify(payloadObj));
        message.destinationName = `agrinode_${MAC_ADDRESS}/control`.toLowerCase();
        try {
            if (loadingMsg) showLoading(loadingMsg);
            mqttClient.send(message);
            setTimeout(() => { hideLoading(); if (onSuccess) onSuccess(); }, 500); 
        } catch (err) {
            hideLoading(); alert("Lỗi gửi tin nhắn: " + err);
        }
    };

    if (isMqttConnected && mqttClient) {
        executeSend();
        return;
    }

    showLoading("Mạng yếu. Đang chờ kết nối...");
    let retryCount = 0;
    const checkItv = setInterval(() => {
        retryCount++;
        if (isMqttConnected && mqttClient) {
            clearInterval(checkItv);
            executeSend(); 
        } else if (retryCount > 15) {
            clearInterval(checkItv);
            hideLoading();
            alert("Mất kết nối với Đám mây. Vui lòng kiểm tra lại mạng!");
        }
    }, 1000);
}

function openDeviceModal() { editingDeviceId = null; document.getElementById('modal-select-type').classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function selectDeviceType(type) {
    tempDeviceType = type; closeModal('modal-select-type'); document.getElementById('dev-name').value = '';
    document.getElementById('dev-cycle-enable').checked = false; toggleCycleSettings(false); renderPinSelect(); autoFillAnimalByZone();
    document.getElementById('smart-animal-config').style.display = (type === 'fan' || type === 'heater') ? 'block' : 'none';
    document.getElementById('config-cycle').style.display = (type === 'fan' || type === 'pump') ? 'block' : 'none';
    document.getElementById('config-title').innerText = "Thêm thiết bị mới"; document.getElementById('modal-config-device').classList.remove('hidden');
}
function openEditModal(id) {
    editingDeviceId = id; const dev = devices.find(d => d.id === id); if(!dev) return; tempDeviceType = dev.type;
    document.getElementById('dev-name').value = dev.name; document.getElementById('dev-zone').value = dev.zone;
    document.getElementById('dev-cycle-enable').checked = dev.isCycleMode;
    if(dev.isCycleMode) { document.getElementById('dev-cycle-on').value = dev.cycleOn; document.getElementById('dev-cycle-off').value = dev.cycleOff; }
    toggleCycleSettings(dev.isCycleMode); renderPinSelect(dev.pin); 
    document.getElementById('smart-animal-config').style.display = (tempDeviceType === 'fan' || tempDeviceType === 'heater') ? 'block' : 'none';
    document.getElementById('config-cycle').style.display = (tempDeviceType === 'fan' || tempDeviceType === 'pump') ? 'block' : 'none';
    document.getElementById('config-title').innerText = "Sửa thiết bị"; document.getElementById('modal-config-device').classList.remove('hidden');
}
function autoFillAnimalByZone() { const z = zones.find(x => x.id === document.getElementById('dev-zone').value); if(z && z.animal !== 'none') { document.getElementById('dev-animal').value = z.animal; applySmartRecommendation(); } }
function applySmartRecommendation() {
    const animal = document.getElementById('dev-animal').value; if (animal === 'none' || !animalData[animal]) return; const d = animalData[animal];
    document.getElementById('dev-threshold').value = d.temp; document.getElementById('threshold-val').innerText = d.temp;
    if (tempDeviceType === 'fan') { document.getElementById('dev-cycle-enable').checked = true; toggleCycleSettings(true); document.getElementById('dev-cycle-on').value = d.cycleOn; document.getElementById('dev-cycle-off').value = d.cycleOff; }
}
function toggleCycleSettings(show) { document.getElementById('cycle-timers').className = show ? 'mt-20 grid-2' : 'hidden mt-20 grid-2'; }

async function saveDevice() {
    const selectedPin = document.getElementById('dev-pin').value; 
    if (!selectedPin) return alert("Vui lòng chọn chân GPIO!");
    
    let inputName = document.getElementById('dev-name').value.trim();
    if (!inputName) { const pinObj = HARDWARE_PINS.find(p => parseInt(p.pin) === parseInt(selectedPin)); inputName = `${deviceTypeNames[tempDeviceType]} (Chân ${pinObj ? pinObj.label : selectedPin})`; }
    const isCycle = document.getElementById('dev-cycle-enable').checked;
    
    const deviceData = {
        id: editingDeviceId ? editingDeviceId : 'dev_' + Date.now(),
        type: tempDeviceType, name: inputName, pin: parseInt(selectedPin), zone: document.getElementById('dev-zone').value, isCycleMode: isCycle,
        cycleOn: isCycle ? parseInt(document.getElementById('dev-cycle-on').value) : 0, cycleOff: isCycle ? parseInt(document.getElementById('dev-cycle-off').value) : 0
    };

    showLoading("Đang đẩy cấu hình...");
    if (!isLocal) {
        deviceData.cmd = "upsert";
        sendMqttAction(deviceData, null, () => { closeModal('modal-config-device'); });
        return;
    }
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch('/api/devices', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(deviceData), signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) { await fetchLocalDevices(); closeModal('modal-config-device'); }
    } catch(e) {}
    hideLoading();
}

let deviceToDelete = null;
function deleteDevice(id) {
    deviceToDelete = id; document.getElementById('modal-confirm').classList.remove('hidden');
    document.getElementById('btn-confirm-delete').onclick = async () => {
        closeModal('modal-confirm'); 
        
        if (!isLocal) {
            const payload = { cmd: "delete", id: deviceToDelete };
            sendMqttAction(payload, "Đang xóa...", () => { deviceToDelete = null; });
            return;
        }

        showLoading("Đang xóa...");
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(`/api/devices?id=${deviceToDelete}`, { method: 'DELETE', signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) await fetchLocalDevices();
        } catch(e) { }
        hideLoading(); deviceToDelete = null; 
    };
}

async function toggleRelay(id, isChecked) {
    const d = devices.find(x => x.id === id); if(!d) return;
    const oldState = d.state; d.state = isChecked ? 'ON' : 'OFF'; renderDevices(); 
    
    if (isLocal) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const res = await fetch('/api/control', { 
                method: 'POST', headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({ id: d.id, state: d.state }), signal: controller.signal 
            });
            clearTimeout(timeoutId);
            if((await res.json()).success) return; 
        } catch(e) {}
    }

    const payload = { id: d.id, state: d.state }; 
    sendMqttAction(payload, null, null); 
}

function updateUIFromData(data) {
    if(data.temp !== undefined) document.getElementById('val-temp').innerText = data.temp;
    if(data.hum !== undefined) document.getElementById('val-hum').innerText = data.hum;
    const z = zones.find(x => x.id === activeZone); const cardTemp = document.getElementById('card-temp');
    if (activeZone !== 'all' && z.alertTemp > 0 && parseFloat(data.temp) < z.alertTemp) cardTemp.classList.add('alert-card'); else cardTemp.classList.remove('alert-card');
    let changed = false;
    if (data.devices) { data.devices.forEach(r => { const dev = devices.find(d => d.id === r.id); if(dev && dev.state !== r.state) { dev.state = r.state; changed = true; } }); }
    if(changed) renderDevices();
}

let isFetchingStatus = false;
setInterval(async () => {
    if(!document.getElementById('view-dashboard').classList.contains('active') || isFetchingStatus) return;
    if (!isLocal) {
        document.getElementById('connection-status').className = isMqttConnected ? 'status-dot online' : 'status-dot offline';
        return;
    }
    isFetchingStatus = true; 
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const res = await fetch('/api/status', { signal: controller.signal });
        clearTimeout(timeoutId);
        document.getElementById('connection-status').className = 'status-dot online';
        updateUIFromData(await res.json());
    } catch(e) { 
         document.getElementById('connection-status').className = isMqttConnected ? 'status-dot online' : 'status-dot offline'; 
    } finally {
        isFetchingStatus = false; 
    }
}, 5000);

function navigate(id) { document.querySelectorAll('.page, .nav-item').forEach(e => e.classList.remove('active')); document.getElementById('view-' + id).classList.add('active'); document.getElementById('nav-' + id).classList.add('active'); }
function showLoading(txt) { const l = document.getElementById('loading'); if(l) { document.getElementById('loading-text').innerText = txt; l.classList.remove('hidden'); } }
function hideLoading() { const l = document.getElementById('loading'); if(l) l.classList.add('hidden'); }

async function scanWiFi() {
    if (!isLocal) return alert("Tính năng này chỉ dành cho mạng cục bộ của thiết bị!");
    showLoading("Đang quét WiFi...");
    try {
        const res = await fetch('/api/wifi/scan'); const networks = await res.json();
        hideLoading(); const select = document.getElementById('wifi-ssid'); select.innerHTML = '<option value="">-- Chọn mạng WiFi --</option>';
        networks.forEach(net => { select.innerHTML += `<option value="${net.ssid}">${net.ssid}</option>`; });
    } catch (e) { hideLoading(); alert("Lỗi khi quét mạng!"); }
}

function saveWiFi(e) {
    e.preventDefault();
    if (!isLocal) return alert("Chỉ cấu hình WiFi khi dùng mạng LAN của mạch!");
    const ssid = document.getElementById('wifi-ssid').value; 
    const pass = document.getElementById('wifi-pass').value;
    if(!ssid) return alert("Vui lòng chọn WiFi!");
    
    showLoading(`Đang cấu hình WiFi: ${ssid}...`);

    // Tạo hàm điều hướng (áp dụng chung cho lúc try catch)
    const handleRedirect = () => {
        hideLoading();
        // Cung cấp cho user 2 tùy chọn chuyển hướng
        const useCloud = confirm("Đã lưu WiFi thành công! Mạch đang khởi động lại.\n\n[OK] Chuyển tới trang quản lý Cloud (GitHub Pages).\n[Cancel] Ở lại trang mạng nội bộ (agrinode.local).");
        if (useCloud) {
            window.location.href = "https://nvnguyen359.github.io/agrinode_web/";
        } else {
            // Mạch sẽ tự kích hoạt lại mDNS sau khi khởi động.
            window.location.href = "http://agrinode.local";
        }
    };
    
    fetch('/api/wifi/save', { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({ ssid, pass }) 
    })
    .then(res => res.json())
    .then(data => {
        handleRedirect();
    })
    .catch(err => { 
        // Khi ESP đổi qua STA (mạng trạm) để kết nối nhà bạn, điện thoại có thể bị văng khỏi WiFi AP của mạch 
        // dẫn tới fetch bị catch ngay lập tức mặc dù lệnh save đã đến mạch. Mình catch để báo luôn.
        handleRedirect();
    });
}

function togglePassword() { const i = document.getElementById('wifi-pass'); i.type = (i.type === 'password') ? 'text' : 'password'; }