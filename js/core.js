// core.js - Config, Store và EventBus
const Config = {
    DEVICE_PREFIX: "Tung_",
    MAC_ADDRESS: "CC50E3DADF75",
    MQTT_BROKER: "cf506bbbf20d4561a8b37f7239c9ca88.s1.eu.hivemq.cloud",
    MQTT_PORT: 8884,
    MQTT_USER: "nvnguyen2504",
    MQTT_PASS: "Mothaiba123",
    GITHUB_VERSION_URL: "https://raw.githubusercontent.com/nvnguyen359/agrinode_update/main/version.json",
    BACKUP_KEY: 'agrinode_devices_backup',
    clientId: "WebClient_" + Math.random().toString(16).substr(2, 8),
    isLocal: window.location.hostname.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/) || window.location.hostname === 'localhost' || window.location.hostname.includes('.local')
};

const MasterData = {
    zones: [
        { id: 'all', name: 'Tất cả', icon: '🏠', animal: 'none' },
        { id: 'z_pig', name: 'Lợn sơ sinh', icon: '🐷', animal: 'pig_baby', alertTemp: 28 },
        { id: 'z_chicken', name: 'Gà úm', icon: '🐣', animal: 'chicken_baby', alertTemp: 32 },
        { id: 'z_pig_adult', name: 'Lợn thịt', icon: '🐖', animal: 'pig', alertTemp: 0 }
    ],
    animalData: {
        'chicken_baby': { temp: 34, cycleOn: 1, cycleOff: 5 },
        'chicken_adult': { temp: 20, cycleOn: 2, cycleOff: 5 },
        'pig_baby': { temp: 32, cycleOn: 1, cycleOff: 10 },
        'pig': { temp: 24, cycleOn: 2, cycleOff: 10 }
    },
    deviceTypeNames: { 'fan': 'Quạt thông gió', 'heater': 'Đèn sưởi', 'pump': 'Máy bơm' },
    svgs: {
        'fan': `<svg class="svg-icon icon-fan {ON_CLASS}" viewBox="0 0 24 24"><g transform="translate(12, 12)"><path d="M0 -1C1.5 -1.5,2.5 -3,2.5 -5C2.5 -6.5,1.5 -7.5,0 -7.5C-1.5 -7.5,-2.5 -6.5,-2.5 -5C-2.5 -3,-1.5 -1.5,0 -1Z"/><path d="M0 -1C1.5 -1.5,2.5 -3,2.5 -5C2.5 -6.5,1.5 -7.5,0 -7.5C-1.5 -7.5,-2.5 -6.5,-2.5 -5C-2.5 -3,-1.5 -1.5,0 -1Z" transform="rotate(120)"/><path d="M0 -1C1.5 -1.5,2.5 -3,2.5 -5C2.5 -6.5,1.5 -7.5,0 -7.5C-1.5 -7.5,-2.5 -6.5,-2.5 -5C-2.5 -3,-1.5 -1.5,0 -1Z" transform="rotate(240)"/></g><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>`,
        'heater': `<svg class="svg-icon icon-heater {ON_CLASS}" viewBox="0 0 24 24"><path d="M9 18h6" /><path d="M10 21h4" /><path d="M12 15v-6" /><path d="M12 2a7 7 0 0 1 7 7c0 2.5 -1.5 4.5 -3 6v1a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-1c-1.5 -1.5 -3 -3.5 -3 -6a7 7 0 0 1 7 -7z" /></svg>`,
        'pump': `<svg class="svg-icon icon-pump {ON_CLASS}" viewBox="0 0 24 24"><path d="M12 3l-6 8a8 8 0 1 0 12 0l-6 -8z" /><path d="M12 15v-2" /><path d="M12 19v-2" /></svg>`
    }
};

class EventBus {
    constructor() { this.listeners = {}; }
    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }
    emit(event, data) {
        if (this.listeners[event]) this.listeners[event].forEach(cb => cb(data));
    }
}
const Events = new EventBus();

class StoreManager {
    constructor() {
        this.state = {
            currentPin: localStorage.getItem('agrinode_pin') || "",
            isMqttConnected: false,
            isWaitingForConnection: false,
            HARDWARE_PINS: [],
            devices: [],
            activeZone: 'all',
            tempDeviceType: '',
            editingDeviceId: null,
            CURRENT_VERSION: "Unknown",
            hasCheckedUpdate: false,
            isFetchingStatus: false,
            lastTelemetryTime: 0,
            settings: { zoneCycles: [] }
        };
    }
    get(key) { return this.state[key]; }
    set(key, value) { 
        this.state[key] = value; 
        Events.emit(`stateChange:${key}`, value); 
    }
    updateDevice(deviceData) {
        const idx = this.state.devices.findIndex(d => d.id === deviceData.id);
        if (idx !== -1) this.state.devices[idx] = deviceData;
        else this.state.devices.push(deviceData);
        this.set('devices', this.state.devices);
    }
    removeDevice(id) {
        this.state.devices = this.state.devices.filter(d => d.id !== id);
        this.set('devices', this.state.devices);
    }
}
const Store = new StoreManager();