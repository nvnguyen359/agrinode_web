// app.js - Composition Root (Khởi tạo và Lắp ráp Hệ thống)
window.App = {
    // Khởi tạo các Class
    AuthCtrl: new AuthController(),
    DeviceCtrl: new DeviceController(),
    SystemCtrl: new SystemController(),
    UI: new UIManager(),

    init: function() {
        // Render danh sách Zone cho Dropdown
        document.getElementById('dev-zone').innerHTML = MasterData.zones.filter(z => z.id !== 'all').map(z => `<option value="${z.id}">${z.icon} ${z.name}</option>`).join('');
        
        // Khởi động UI Ban đầu
        if (Store.get('currentPin')) {
            Events.emit('ui:hidePinLock');
            document.getElementById('secret-pin-input').value = Store.get('currentPin'); 
            Events.emit('ui:showLoading', "Đang kết nối lại...");
            setTimeout(() => this.AuthCtrl.checkPin(Store.get('currentPin')), 500);
        } else {
            Events.emit('ui:showPinLock');
        }

        Network.initMQTT();
        this.UI.navigate('dashboard');
        
        if (Config.isLocal) this.loadLocalDataBg();

        // Loop trạng thái và Timer
        setInterval(() => this.fetchStatusBg(), 5000);
        setInterval(() => this.countdownLoop(), 1000);
    },

    loadLocalDataBg: async function() {
        try {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 3000);
            fetch('/api/info?_t=' + Date.now(), { signal: controller.signal })
            .then(res => { if (res.ok) Events.emit('networkStatus', 'online'); return res.json(); })
            .then(infoData => {
                Store.set('HARDWARE_PINS', infoData.hardware_pins);
                if (infoData.version) this.SystemCtrl.handleVersionReport(infoData.version);
            }).catch(e => console.warn(e));
        } catch(e) {}
        await this.DeviceCtrl.fetchLocalDevices();
    },

    fetchStatusBg: async function() {
        if(!document.getElementById('view-dashboard').classList.contains('active') || Store.get('isFetchingStatus')) return;
        if (!Config.isLocal) { 
            const isDeviceOnline = Store.get('isMqttConnected') && (Date.now() - Store.get('lastTelemetryTime') < 15000);
            Events.emit('networkStatus', isDeviceOnline ? 'online' : 'offline');
            return; 
        }
        Store.set('isFetchingStatus', true); 
        try {
            const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 4000);
            const res = await fetch('/api/status?_t=' + Date.now(), { signal: controller.signal });
            clearTimeout(timeoutId);
            Events.emit('networkStatus', 'online');
            Events.emit('mqttTelemetryReceived', await res.json());
        } catch(e) { Events.emit('networkStatus', 'offline'); }
        finally { Store.set('isFetchingStatus', false); }
    },

    countdownLoop: function() {
        const devices = Store.get('devices');
        if (devices.length === 0) return;
        let changed = false;
        devices.forEach(dev => {
            if (dev.timeLeft !== undefined && dev.timeLeft > 0) {
                dev.timeLeft--; changed = true;
                const timerEl = document.getElementById(`timer-${dev.id}`);
                if (timerEl) timerEl.innerHTML = `Đảo trạng thái sau: <strong style="color:red">${Math.floor(dev.timeLeft/60)}p ${dev.timeLeft%60}s</strong>`;
            }
        });
        if(changed) Store.set('devices', devices);
    },

    // Hàm gọi từ HTML Form (DOM Wrapper)
    triggerPinCheck: function() {
        const val = document.getElementById('secret-pin-input').value;
        if(val.length === 6) this.AuthCtrl.checkPin(val);
    },
    saveWiFiSubmit: function(e) {
        e.preventDefault();
        const ssid = document.getElementById('wifi-ssid').value, pass = document.getElementById('wifi-pass').value;
        if(!ssid) return Events.emit('ui:showAlert', {title:"Lỗi", message:"Chọn WiFi!", icon:"⚠️"});
        this.SystemCtrl.saveWiFi(ssid, pass);
    }
};

window.onload = () => App.init();