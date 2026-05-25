// network.js - Quản lý kết nối MQTT và Giao tiếp Mạng
const Network = {
    initMQTT: function() {
        if (!State.mqttClient) {
            State.mqttClient = new Paho.MQTT.Client(Config.MQTT_BROKER, Config.MQTT_PORT, "/mqtt", Config.clientId);
            
            State.mqttClient.onConnectionLost = () => { 
                State.isMqttConnected = false; 
                document.getElementById('connection-status').className = 'status-dot offline'; 
                setTimeout(Network.connectMQTT, 3000); 
            };
            
            State.mqttClient.onMessageArrived = (msg) => {
                if (msg.retained) return; 
                
                // FIX: Dùng Config.DEVICE_PREFIX thay vì hardcode agrinode_
                const TOPIC_CONFIG = `${Config.DEVICE_PREFIX}${Config.MAC_ADDRESS}/config`.toLowerCase();
                const TOPIC_TELEMETRY = `${Config.DEVICE_PREFIX}${Config.MAC_ADDRESS}/telemetry`.toLowerCase();

                if (msg.destinationName === TOPIC_CONFIG) {
                    const data = JSON.parse(msg.payloadString);
                    Network.handleConfigMessage(data);
                } else if (msg.destinationName === TOPIC_TELEMETRY) {
                    const data = JSON.parse(msg.payloadString);
                    
                    if (data.ota_progress !== undefined) {
                        UI.showOtaProgress(data.ota_progress);
                    }
                    UI.updateTelemetryUI(data);
                }
            };
        }
        Network.connectMQTT();
    },

    connectMQTT: function() {
        if (State.isMqttConnected || !State.mqttClient) return; 
        
        State.mqttClient.connect({ 
            userName: Config.MQTT_USER, password: Config.MQTT_PASS, useSSL: true, timeout: 10,
            onSuccess: () => { 
                State.isMqttConnected = true; 
                document.getElementById('connection-status').className = 'status-dot online';
                
                // FIX: Lắng nghe đúng kênh của mạch
                State.mqttClient.subscribe(`${Config.DEVICE_PREFIX}${Config.MAC_ADDRESS}/telemetry`.toLowerCase()); 
                State.mqttClient.subscribe(`${Config.DEVICE_PREFIX}${Config.MAC_ADDRESS}/config`.toLowerCase()); 
                
                if (State.isWaitingForConnection && State.currentPin) {
                    State.isWaitingForConnection = false;
                    App.checkPin(); 
                } else if (State.currentPin && !State.isWaitingForConnection && !Config.isLocal) {
                    UI.showLoading("Đang đồng bộ dữ liệu...");
                    const msg = new Paho.MQTT.Message(JSON.stringify({ cmd: "get_config", auth_pin: State.currentPin, client_id: Config.clientId }));
                    msg.destinationName = `${Config.DEVICE_PREFIX}${Config.MAC_ADDRESS}/control`.toLowerCase();
                    State.mqttClient.send(msg);
                }
            },
            onFailure: (err) => { setTimeout(Network.connectMQTT, 3000); }
        });
    },

    handleConfigMessage: function(data) {
        if (data.cmd_response === "wifi_scan") {
            UI.populateWiFiList(data.networks || []);
            return;
        }
        if (data.cmd_response === "wifi_save") {
            UI.hideLoading();
            if (data.success) {
                UI.showAlert("Thành công", "Đã cấu hình WiFi thành công! Mạch đang khởi động lại. Nếu mạch mất kết nối lâu, có thể do sai mật khẩu WiFi.", "✅");
            } else {
                UI.showAlert("Thất bại", "Không thể kết nối mạng WiFi này. Mạch sẽ quay lại cấu hình cũ.", "❌");
            }
            return;
        }

        if (data.version) {
            State.CURRENT_VERSION = data.version;
            UI.updateVersionUI(State.CURRENT_VERSION);
            if (!State.hasCheckedUpdate && !Config.isLocal) { 
                State.hasCheckedUpdate = true; setTimeout(OTA.autoCheckUpdate, 2000); 
            }
        }

        if (data.auth) {
            if (data.client_id && data.client_id !== Config.clientId) return;
            if (data.auth === "ok") {
                localStorage.setItem('agrinode_pin', State.currentPin); 
                document.getElementById('pin-lock-overlay').classList.add('hidden');
                document.getElementById('pin-error-msg').style.display = 'none';
                document.getElementById('pin-status-msg').style.display = 'none';
                
                if (!Config.isLocal) {
                    UI.showLoading("Đang tải dữ liệu thiết bị...");
                    const confMsg = new Paho.MQTT.Message(JSON.stringify({ cmd: "get_config", auth_pin: State.currentPin, client_id: Config.clientId }));
                    confMsg.destinationName = `${Config.DEVICE_PREFIX}${Config.MAC_ADDRESS}/control`.toLowerCase();
                    State.mqttClient.send(confMsg);
                } else { UI.hideLoading(); }
            } else {
                UI.hideLoading();
                document.getElementById('pin-error-msg').style.display = 'block'; 
                document.getElementById('secret-pin-input').value = '';
                State.currentPin = ""; localStorage.removeItem('agrinode_pin');
                document.getElementById('pin-lock-overlay').classList.remove('hidden');
                document.getElementById('pin-status-msg').style.display = 'none';
            }
        }

        let dataHasUpdated = false;
        if (data.hardware_pins) { 
            State.HARDWARE_PINS = data.hardware_pins.map(p => typeof p === 'object' ? p : {pin: p, label: 'D'+p});
            dataHasUpdated = true; 
        }
        
        if (data.devices) { State.devices = data.devices; dataHasUpdated = true; App.checkAndRestoreBackup(); } 
        else if (Array.isArray(data)) { State.devices = data; dataHasUpdated = true; App.checkAndRestoreBackup(); }
        
        if (data.settings) {
            State.settings = data.settings;
            dataHasUpdated = true;
        }
        
        if (dataHasUpdated) { UI.hideLoading(); UI.renderZones(); UI.renderPinSelect(); UI.renderDevices(); }
    },

    sendAction: function(payloadObj, loadingMsg, onSuccess) {
        payloadObj.auth_pin = State.currentPin; 
        
        const executeSend = () => {
            const message = new Paho.MQTT.Message(JSON.stringify(payloadObj));
            // FIX: Gửi đúng kênh
            message.destinationName = `${Config.DEVICE_PREFIX}${Config.MAC_ADDRESS}/control`.toLowerCase();
            try {
                if (loadingMsg) UI.showLoading(loadingMsg);
                State.mqttClient.send(message);
                setTimeout(() => { UI.hideLoading(); if (onSuccess) onSuccess(); }, 500); 
            } catch (err) {
                UI.hideLoading(); UI.showAlert("Lỗi", "Lỗi gửi tin nhắn MQTT: " + err, "❌");
            }
        };

        if (State.isMqttConnected && State.mqttClient) {
            executeSend(); return;
        }

        UI.showLoading("Mạng yếu. Đang chờ kết nối...");
        let retryCount = 0;
        const checkItv = setInterval(() => {
            retryCount++;
            if (State.isMqttConnected && State.mqttClient) {
                clearInterval(checkItv); executeSend(); 
            } else if (retryCount > 15) {
                clearInterval(checkItv); UI.hideLoading();
                UI.showAlert("Mất kết nối", "Không thể kết nối Đám mây. Vui lòng kiểm tra lại mạng!", "🔌");
            }
        }, 1000);
    }
};