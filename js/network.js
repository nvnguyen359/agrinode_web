// network.js - Dịch vụ Mạng độc lập
class NetworkService {
    constructor() {
        this.mqttClient = null;
    }

    initMQTT() {
        if (!this.mqttClient) {
            this.mqttClient = new Paho.MQTT.Client(Config.MQTT_BROKER, Config.MQTT_PORT, "/mqtt", Config.clientId);
            
            this.mqttClient.onConnectionLost = () => { 
                Store.set('isMqttConnected', false);
                Events.emit('networkStatus', 'offline');
                setTimeout(() => this.connectMQTT(), 3000); 
            };
            
            this.mqttClient.onMessageArrived = (msg) => {
                if (msg.retained) return;
                const TOPIC_CONFIG = `${Config.DEVICE_PREFIX}${Config.MAC_ADDRESS}/config`.toLowerCase();
                const TOPIC_TELEMETRY = `${Config.DEVICE_PREFIX}${Config.MAC_ADDRESS}/telemetry`.toLowerCase();

                if (msg.destinationName === TOPIC_CONFIG) {
                    Store.set('lastTelemetryTime', Date.now());
                    Events.emit('networkStatus', 'online');
                    Events.emit('mqttConfigReceived', JSON.parse(msg.payloadString));
                } else if (msg.destinationName === TOPIC_TELEMETRY) {
                    Store.set('lastTelemetryTime', Date.now());
                    Events.emit('networkStatus', 'online');
                    Events.emit('mqttTelemetryReceived', JSON.parse(msg.payloadString));
                }
            };
        }
        this.connectMQTT();
    }

    connectMQTT() {
        if (Store.get('isMqttConnected') || !this.mqttClient) return; 
        this.mqttClient.connect({ 
            userName: Config.MQTT_USER, password: Config.MQTT_PASS, useSSL: true, timeout: 10,
            onSuccess: () => { 
                Store.set('isMqttConnected', true);
                this.mqttClient.subscribe(`${Config.DEVICE_PREFIX}${Config.MAC_ADDRESS}/telemetry`.toLowerCase()); 
                this.mqttClient.subscribe(`${Config.DEVICE_PREFIX}${Config.MAC_ADDRESS}/config`.toLowerCase()); 
                Events.emit('mqttConnected', null);
            },
            onFailure: (err) => { setTimeout(() => this.connectMQTT(), 3000); }
        });
    }

    sendAction(payloadObj, loadingMsg, onSuccess) {
        payloadObj.auth_pin = Store.get('currentPin'); 
        
        const executeSend = () => {
            const message = new Paho.MQTT.Message(JSON.stringify(payloadObj));
            message.destinationName = `${Config.DEVICE_PREFIX}${Config.MAC_ADDRESS}/control`.toLowerCase();
            try {
                if (loadingMsg) Events.emit('ui:showLoading', loadingMsg);
                this.mqttClient.send(message);
                setTimeout(() => { 
                    Events.emit('ui:hideLoading'); 
                    if (onSuccess) onSuccess(); 
                }, 500); 
            } catch (err) {
                Events.emit('ui:hideLoading'); 
                Events.emit('ui:showAlert', { title: "Lỗi", message: "Lỗi gửi tin nhắn MQTT: " + err, icon: "❌" });
            }
        };

        if (Store.get('isMqttConnected') && this.mqttClient) { executeSend(); return; }

        Events.emit('ui:showLoading', "Mạng yếu. Đang chờ kết nối...");
        let retryCount = 0;
        const checkItv = setInterval(() => {
            retryCount++;
            if (Store.get('isMqttConnected') && this.mqttClient) {
                clearInterval(checkItv); executeSend(); 
            } else if (retryCount > 15) {
                clearInterval(checkItv); Events.emit('ui:hideLoading');
                Events.emit('ui:showAlert', { title: "Mất kết nối", message: "Không thể kết nối Đám mây. Vui lòng kiểm tra lại mạng!", icon: "🔌" });
            }
        }, 1000);
    }
}
const Network = new NetworkService();